import { useState } from 'react'
import { Answer } from './RevealAnswer'
import { statKey } from './reveal'
import { CardSection } from './CardSection'
import { CardShell, ListField, NumField, Seg, stop } from './StatsCard'
import { useInk } from './inkContext'
import type { BoardDataPlot, DataPlotCardData, DataPlotCardSet, DataPlotSet } from './dataPlotLinks'
import { EXAMPLE_SETS, QUARTILE_METHOD, nextSetName, short } from './dataPlotLinks'
import { MAX_SETS, MAX_SET_NAME } from '../core/statsPersist'
import type { DataDist } from '../core/statsPersist'

// ============================================================================
// src/ui/DataPlotCard.tsx — a one-variable data plot in the sidebar list
// (Build ▾ → One-variable data; NC Math 1 S-ID.1–3).
//
//   DATA       one or more lists (paste, type, or copy a column from a data
//              table), each with its name; the example compares two classes
//   SHOW       dot plot / histogram / neither, and the box plot; the bin width
//   SUMMARY    n, mean, Sx, σx, the five-number summary, range, IQR, mode —
//              one column per set, the quartile method stated
//   SHAPE      "appears skewed left" and why; the measures that suit it
//   COMPARE    the sentence comparing the sets' centre and spread
//   OUTLIERS   the 1.5·IQR fences and the outliers; leave them out, or click
//              dots on the board; the before / after table and what moved
//
// Nothing here computes anything: every string arrives from
// src/ui/dataPlotLinks.ts, the same numbers the board draws.
// ============================================================================

/** A column of a data table, offered for copying into a set. */
export interface TableColumn {
  key: string
  label: string
  values: number[]
}

export interface DataPlotCardProps {
  p: BoardDataPlot
  card: DataPlotCardData
  selected: boolean
  /** Columns of the board's data tables. */
  columns: readonly TableColumn[]
  onSelect(): void
  onDelete(): void
  onToggleVisible(): void
  onCycleColor(): void
  onZoom(): void
  onPatch(patch: Partial<BoardDataPlot>, label: string): void
}

/** A set's name: Enter or blur commits. */
function NameField({ value, onCommit, label }: { value: string; onCommit(v: string): void; label: string }) {
  const [text, setText] = useState<string | null>(null)
  const commit = (): void => {
    if (text === null) return
    const t = text.trim().slice(0, MAX_SET_NAME)
    setText(null)
    if (t && t !== value) onCommit(t)
  }
  return (
    <input
      className="calc-input rr-input dp-name"
      type="text"
      spellCheck={false}
      autoComplete="off"
      aria-label={label}
      data-testid="dp-set-name"
      value={text ?? value}
      onClick={stop}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        } else if (e.key === 'Escape') {
          setText(null)
          e.currentTarget.blur()
        }
      }}
      onBlur={commit}
    />
  )
}

function SummaryTable({ sets }: { sets: readonly DataPlotCardSet[] }) {
  const ink = useInk()
  const rows = sets[0]?.table ?? []
  return (
    <table className="stat-me dp-table" data-testid="dp-summary">
      {sets.length > 1 && (
        <thead>
          <tr>
            <th />
            {sets.map((s, i) => (
              <th key={i} style={{ color: ink(s.color) }}>
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {rows.map((r, k) => (
          <tr key={r.key} data-stat={r.key}>
            <td className="dp-label">{r.label}</td>
            {sets.map((s, i) => (
              <td key={i}>{s.table[k]?.value ?? '—'}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function DataPlotCard(props: DataPlotCardProps) {
  const { p, card } = props
  const ink = useInk()
  const ak = statKey(p.id)
  const patchSets = (sets: DataPlotSet[], label: string): void => props.onPatch({ sets }, label)
  const setAt = (i: number, next: DataPlotSet, label: string): void => patchSets(p.sets.map((s, k) => (k === i ? next : s)), label)
  const multi = p.sets.length > 1
  const anyLeft = card.sets.some((s) => s.leftOut.length > 0)
  const anyOutliers = card.sets.some((s) => s.fences.outliers.length > 0)
  const [pick, setPick] = useState('')

  return (
    <CardShell
      color={p.color}
      hidden={p.hidden === true}
      selected={props.selected}
      name="One-variable data"
      testId="data-plot-card"
      summary={card.summary}
      answerKey={ak}
      onSelect={props.onSelect}
      onDelete={props.onDelete}
      onToggleVisible={props.onToggleVisible}
      onCycleColor={props.onCycleColor}
      onZoom={props.onZoom}
    >
      <CardSection kind="stat-data-sets" title="Data" summary={p.sets.map((s) => `${s.name}: ${s.values.length}`).join(' · ')}>
        {p.sets.map((set, i) => (
          <div key={i} className="dp-set" data-testid="dp-set">
            <div className="dp-set-head">
              <span className="dp-swatch" style={{ background: ink(card.sets[i]?.color ?? p.color) }} aria-hidden="true" />
              <NameField value={set.name} label={`name of data set ${i + 1}`} onCommit={(v) => setAt(i, { ...set, name: v }, `rename ${set.name}`)} />
              {multi && (
                <button
                  type="button"
                  className="calc-drop"
                  aria-label={`Remove ${set.name}`}
                  title="Remove this data set"
                  onClick={(e) => {
                    e.stopPropagation()
                    patchSets(p.sets.filter((_, k) => k !== i), `remove ${set.name}`)
                  }}
                >
                  ×
                </button>
              )}
            </div>
            <ListField
              values={set.values}
              label={`values of ${set.name}`}
              testId="dp-values"
              placeholder="Paste or type the values: 72, 75 68 80 … (commas, spaces or new lines)"
              onCommit={(v) => setAt(i, { name: set.name, values: v }, `values of ${set.name}`)}
            />
          </div>
        ))}
        <div className="data-actions dp-actions">
          {p.sets.length < MAX_SETS && (
            <button
              type="button"
              className="calc-chip"
              data-testid="dp-add-set"
              title="Another data set on the same number line — parallel box plots for comparing"
              onClick={(e) => {
                e.stopPropagation()
                patchSets([...p.sets, { name: nextSetName(p.sets), values: [] }], 'add data set')
              }}
            >
              + data set
            </button>
          )}
          {props.columns.length > 0 && (
            <select
              className="calc-select"
              aria-label="Copy a column from a data table"
              data-testid="dp-from-table"
              value={pick}
              onClick={stop}
              onChange={(e) => {
                const col = props.columns.find((c) => c.key === e.target.value)
                setPick('')
                if (!col || col.values.length === 0) return
                const last = p.sets[p.sets.length - 1]
                const fresh: DataPlotSet = { name: col.label.slice(0, MAX_SET_NAME), values: col.values.slice() }
                if (last && last.values.length === 0) patchSets([...p.sets.slice(0, -1), fresh], `copy ${col.label}`)
                else if (p.sets.length < MAX_SETS) patchSets([...p.sets, fresh], `copy ${col.label}`)
              }}
            >
              <option value="">From a table…</option>
              {props.columns.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label} ({c.values.length})
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="calc-chip"
            data-testid="dp-example"
            title="Two classes’ unit-test scores (one with an outlier)"
            onClick={(e) => {
              e.stopPropagation()
              patchSets(EXAMPLE_SETS.map((s) => ({ name: s.name, values: s.values.slice() })), 'example data')
            }}
          >
            use the example
          </button>
        </div>
      </CardSection>

      <CardSection
        kind="stat-data-show"
        title="Show"
        summary={[p.dist === 'dots' ? 'dot plot' : p.dist === 'hist' ? 'histogram' : '', p.box ? 'box plot' : ''].filter(Boolean).join(', ') || 'nothing'}
      >
        <Seg<DataDist>
          options={[
            { v: 'dots', text: 'Dot plot' },
            { v: 'hist', text: 'Histogram' },
            { v: 'none', text: 'Neither' },
          ]}
          value={p.dist}
          label="Distribution"
          testId="dp-dist"
          onPick={(v) => props.onPatch({ dist: v }, v === 'hist' ? 'histogram' : v === 'dots' ? 'dot plot' : 'no dot plot or histogram')}
        />
        <div className="uc-toggles">
          <label className="te-check" onClick={stop} title="The modified box plot: whiskers to the most extreme values inside the fences, outliers as separate points">
            <input type="checkbox" checked={p.box} data-testid="dp-box" onChange={() => props.onPatch({ box: !p.box }, p.box ? 'no box plot' : 'box plot')} />
            <span>box plot (outliers as separate points)</span>
          </label>
        </div>
        {p.dist === 'hist' && (
          <div className="rr-givens">
            <label className="rr-given" onClick={stop} title="The width of each bar; a value on an edge counts in the bar to its right, as on a TI-84">
              <span className="calc-tag">bin width</span>
              <NumField
                value={card.binWidth}
                label="bin width"
                testId="dp-bin"
                onCommit={(v) => (v > 0 ? (props.onPatch({ binWidth: v }, `bin width ${short(v, 6)}`), null) : 'A positive width.')}
              />
            </label>
            {!card.binAuto && (
              <button
                type="button"
                className="calc-chip"
                data-testid="dp-bin-auto"
                title="Go back to the default width for this data"
                onClick={(e) => {
                  e.stopPropagation()
                  props.onPatch({ binWidth: undefined }, 'default bin width')
                }}
              >
                auto
              </button>
            )}
          </div>
        )}
        {p.dist === 'hist' && card.binNote && (
          <div className="rr-sentence" data-testid="dp-bin-note">
            {card.binNote}
          </div>
        )}
      </CardSection>

      {card.ok && (
        <CardSection kind="stat-data-summary" title="Summary" summary={card.summary} answerKey={ak}>
          <Answer k={ak} block what="the summary statistics">
            <SummaryTable sets={card.sets} />
          </Answer>
          <div className="field-hint dp-method" data-testid="dp-method">
            {QUARTILE_METHOD}
          </div>
        </CardSection>
      )}

      {card.ok && (
        <CardSection kind="stat-data-shape" title="Shape and centre" answerKey={ak} summary={card.sets.map((s) => s.shape).join('; ')}>
          <Answer k={ak} block what="the shape">
            <div className="uc-facts" data-testid="dp-shape">
              {card.sets.map((s, i) =>
                s.n === 0 ? null : (
                  <div key={i} className="dp-shape-line">
                    <div>
                      <span className="uc-k" style={multi ? { color: ink(s.color) } : undefined}>
                        {s.shape}
                      </span>{' '}
                      <span className="uc-dim">({s.shapeReason})</span>
                    </div>
                    <div className="field-hint rr-sentence">{s.recommend}</div>
                  </div>
                ),
              )}
            </div>
          </Answer>
        </CardSection>
      )}

      {card.compare && (
        <CardSection kind="stat-data-compare" title="Compare" answerKey={ak} summary={card.compare}>
          <Answer k={ak} block what="the comparison">
            <div className="field-hint rr-sentence dp-compare" data-testid="dp-compare">
              {card.compare}
            </div>
          </Answer>
        </CardSection>
      )}

      {card.ok && (
        <CardSection kind="stat-data-outliers" title="Outliers" answerKey={ak} summary={anyOutliers ? card.sets.map((s) => `${s.fences.outliers.length}`).join(' · ') + ' outliers' : 'none'}>
          <Answer k={ak} block what="the fences and outliers">
            <div className="uc-facts" data-testid="dp-fences">
              {card.sets.map((s, i) =>
                s.n === 0 ? null : (
                  <div key={i}>
                    {multi && <span style={{ color: ink(s.color) }}>{s.name}: </span>}
                    fences Q1 − 1.5·IQR = <span className="uc-k">{s.fences.lower}</span>, Q3 + 1.5·IQR ={' '}
                    <span className="uc-k">{s.fences.upper}</span>;{' '}
                    {s.fences.outliers.length === 0 ? 'no outliers' : `outlier${s.fences.outliers.length === 1 ? '' : 's'}: ${s.fences.outliers.join(', ')}`}
                  </div>
                ),
              )}
            </div>
          </Answer>
          <div className="uc-toggles">
            <label className="te-check" onClick={stop} title="Leave every value outside the fences out of the summaries, and see what changes">
              <input
                type="checkbox"
                checked={p.dropOutliers === true}
                data-testid="dp-drop-outliers"
                onChange={() => props.onPatch({ dropOutliers: p.dropOutliers ? undefined : true }, p.dropOutliers ? 'keep outliers' : 'leave outliers out')}
              />
              <span>leave the outliers out</span>
            </label>
          </div>
          <div className="field-hint">
            {p.dist === 'hist'
              ? 'Switch to the dot plot to click single values out on the board.'
              : 'With this card selected, click a dot on the board to leave it out; click it again to bring it back.'}
          </div>
          {anyLeft && (
            <div className="dp-left" data-testid="dp-left">
              {card.sets.map((s, si) =>
                s.leftOut.length === 0 ? null : (
                  <div key={si} className="dp-left-row">
                    <span className="calc-tag">{multi ? `${s.name} left out` : 'left out'}</span>
                    {s.leftOut.map((o) =>
                      o.why === 'clicked' ? (
                        <button
                          key={o.i}
                          type="button"
                          className="calc-chip"
                          title="Bring this value back"
                          onClick={(e) => {
                            e.stopPropagation()
                            const set = p.sets[si]
                            const off = (set.off ?? []).filter((x) => x !== o.i)
                            const next: DataPlotSet = { name: set.name, values: set.values }
                            if (off.length > 0) next.off = off
                            setAt(si, next, `bring back ${o.value}`)
                          }}
                        >
                          {o.value} ×
                        </button>
                      ) : (
                        <span key={o.i} className="calc-chip dp-outlier-chip" title="Left out as an outlier (the switch above)">
                          {o.value}
                        </span>
                      ),
                    )}
                  </div>
                ),
              )}
            </div>
          )}
          {card.sets.map((s, si) =>
            !s.effect ? null : (
              <Answer key={si} k={ak} block what="the before and after">
                <div className="dp-effect" data-testid="dp-effect">
                  {multi && <div className="stat-group-label">{s.name}</div>}
                  <table className="stat-me">
                    <thead>
                      <tr>
                        <th />
                        <th>all {s.effect.before.n}</th>
                        <th>without</th>
                        <th>change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.effect.rows.map((r) => (
                        <tr key={r.key} className={r.key === s.effect!.ranked[0] ? 'dp-moved' : undefined}>
                          <td className="dp-label">{r.label}</td>
                          <td>{short(r.before, 4)}</td>
                          <td>{short(r.after, 4)}</td>
                          <td>{Number.isFinite(r.change) ? `${r.change > 0 ? '+' : ''}${short(r.change, 4)}` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="field-hint rr-sentence" data-testid="dp-effect-sentence">
                    {s.effect.sentence}
                  </div>
                </div>
              </Answer>
            ),
          )}
        </CardSection>
      )}
    </CardShell>
  )
}

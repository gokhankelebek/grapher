import { useState } from 'react'
import { Answer } from './RevealAnswer'
import { statKey } from './reveal'
import { CardSection } from './CardSection'
import { CardShell, Seg, stop } from './StatsCard'
import type { BoardProb, ProbCardData, ReadLine } from './probLinks'
import { sortKeys } from './probLinks'
import type { ProbStage, ProbTable, ProbTree, ProbVenn, ProbView } from '../core/probPersist'
import {
  EXAMPLE_TABLE,
  EXAMPLE_TABLE_INDEPENDENT,
  EXAMPLE_TREE,
  EXAMPLE_VENN,
  EXAMPLE_VENN3_REGIONS,
  MAX_BAG,
  MAX_COLORS,
  MAX_COUNT,
  MAX_DIM,
  MAX_DRAWS,
  MAX_EXPR,
  MAX_LABEL,
  MAX_TEXT,
  MAX_TREE_OUTCOMES,
  MAX_TREE_STAGES,
  MIN_DIM,
  cloneTable,
  cloneTree,
} from '../core/probPersist'
import type { RelView } from '../core/probability'
import { parseFrac, stageNodes } from '../core/probability'

// ============================================================================
// src/ui/ProbCard.tsx — a Probability object in the sidebar list (Build ▾ →
// Probability; NC Math 2 S-CP.1, 3–8). Three views of one object:
//
//   TWO-WAY TABLE  labels and counts (totals computed), A = a row, B = a
//                  column, P(A|B) or P(B|A), counts or joint / row / column
//                  percentages; the readouts and the independence check
//   VENN DIAGRAM   two or three sets, a value per region (or the table's), an
//                  event typed with ∪ ∩ ᶜ, its probability as a sum of regions
//                  and by the Addition Rule
//   TREE DIAGRAM   a bag (counts per colour, draws, with or without
//                  replacement) or typed stages; path products by the
//                  Multiplication Rule; an event as a sum of paths
//
// Nothing here computes a probability: every string arrives from
// src/ui/probLinks.ts, the same numbers the board draws.
// ============================================================================

export interface ProbCardProps {
  p: BoardProb
  card: ProbCardData
  selected: boolean
  onSelect(): void
  onDelete(): void
  onToggleVisible(): void
  onCycleColor(): void
  onZoom(): void
  onPatch(patch: Partial<BoardProb>, label: string): void
}

/** A text box that commits on Enter or blur; `check` may refuse with a reason. */
function TextField({
  value,
  onCommit,
  label,
  testId,
  width,
  max = MAX_LABEL,
  check,
  className = '',
  placeholder,
}: {
  value: string
  onCommit(v: string): void
  label: string
  testId?: string
  width?: string
  max?: number
  check?(v: string): string | null
  className?: string
  placeholder?: string
}) {
  const [text, setText] = useState<string | null>(null)
  const [bad, setBad] = useState<string | null>(null)
  const commit = (): void => {
    if (text === null) return
    const t = text.trim().slice(0, max)
    const err = check ? check(t) : null
    if (err) {
      setBad(err)
      return
    }
    setText(null)
    setBad(null)
    if (t !== value) onCommit(t)
  }
  return (
    <input
      className={`calc-input rr-input prob-input${bad ? ' fe-input-bad' : ''}${className ? ` ${className}` : ''}`}
      style={width ? { width } : undefined}
      type="text"
      spellCheck={false}
      autoComplete="off"
      aria-label={label}
      title={bad ?? undefined}
      placeholder={placeholder}
      data-testid={testId}
      value={text ?? value}
      onClick={stop}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        setText(e.target.value)
        setBad(null)
      }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        } else if (e.key === 'Escape') {
          setText(null)
          setBad(null)
          e.currentTarget.blur()
        }
      }}
      onBlur={commit}
    />
  )
}

const wholeCheck =
  (max: number) =>
  (v: string): string | null =>
    /^\d+$/.test(v) && Number(v) <= max ? null : `A whole number from 0 to ${max}.`

const probCheck = (v: string): string | null => {
  if (v === '') return null
  const f = parseFrac(v)
  return f && f.n >= 0n ? null : 'A number, fraction or percent: 12, 0.35, 3/10, 35%.'
}

function Lines({ lines, testId }: { lines: readonly ReadLine[]; testId: string }) {
  return (
    <table className="stat-me prob-lines" data-testid={testId}>
      <tbody>
        {lines.map((l) => (
          <tr key={l.key} data-line={l.key}>
            <td className="dp-label">{l.label}</td>
            <td>
              <span className="uc-k">{l.value}</span>
              {l.hint && <div className="field-hint">{l.hint}</div>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const VENN_CHIPS2 = ['A ∪ B', 'A ∩ B', 'Aᶜ', 'A ∩ Bᶜ', 'Aᶜ ∩ B', '(A ∪ B)ᶜ', '(A ∩ B)ᶜ']
const VENN_CHIPS3 = ['A ∪ B ∪ C', 'A ∩ B ∩ C', 'A ∩ Bᶜ ∩ Cᶜ', '(A ∪ B) ∩ C', 'A ∩ (B ∪ C)', '(A ∪ B ∪ C)ᶜ']

export function ProbCard(props: ProbCardProps) {
  const { p, card } = props
  const ak = statKey(p.id)
  const setTable = (patch: Partial<ProbTable>, label: string): void => props.onPatch({ table: { ...cloneTable(p.table), ...patch } }, label)
  const setVenn = (patch: Partial<ProbVenn>, label: string): void =>
    props.onPatch({ venn: { ...p.venn, names: p.venn.names.slice(), regions: p.venn.regions.slice(), ...patch } }, label)
  const setTree = (patch: Partial<ProbTree>, label: string): void => {
    const next: ProbTree = { ...cloneTree(p.tree), ...patch }
    if (!('event' in patch)) delete next.event
    if (patch.event === undefined) delete next.event
    props.onPatch({ tree: next }, label)
  }
  /** A new tree (bag or stages changed): a named event follows onto it (the App settles it), a hand-picked one keeps the leaves that remain. */
  const rebuildTree = (patch: Partial<ProbTree>, label: string): void => setTree({ pick: p.tree.pick, event: p.tree.event, ...patch }, label)

  return (
    <CardShell
      color={p.color}
      hidden={p.hidden === true}
      selected={props.selected}
      name="Probability"
      testId="prob-card"
      summary={card.summary}
      answerKey={ak}
      onSelect={props.onSelect}
      onDelete={props.onDelete}
      onToggleVisible={props.onToggleVisible}
      onCycleColor={props.onCycleColor}
      onZoom={props.onZoom}
    >
      <div className="prob-view">
        <Seg<ProbView>
          options={[
            { v: 'table', text: 'Two-way table', title: 'Counts in a table: joint, marginal and conditional probabilities, independence' },
            { v: 'venn', text: 'Venn', title: 'Two or three events: shade an event, its probability by the Addition Rule' },
            { v: 'tree', text: 'Tree', title: 'Stages and branches: path products by the Multiplication Rule' },
          ]}
          value={p.view}
          label="View"
          testId="prob-view"
          onPick={(v) => props.onPatch({ view: v }, v === 'table' ? 'two-way table' : v === 'venn' ? 'Venn diagram' : 'tree diagram')}
        />
      </div>
      {p.view === 'table' && <TableBody {...props} ak={ak} setTable={setTable} />}
      {p.view === 'venn' && <VennBody {...props} ak={ak} setVenn={setVenn} />}
      {p.view === 'tree' && <TreeBody {...props} ak={ak} setTree={setTree} rebuildTree={rebuildTree} />}
    </CardShell>
  )
}

// ---------------------------------------------------------------------------
// Two-way table
// ---------------------------------------------------------------------------

function TableBody({ p, card, ak, setTable }: ProbCardProps & { ak: string; setTable(patch: Partial<ProbTable>, label: string): void }) {
  const t = p.table
  const R = t.rows.length
  const C = t.cols.length
  const c = card.table
  const rel = t.rel
  return (
    <>
      <CardSection kind="prob-table" title="Table" summary={`${R} × ${C}, ${card.table.cells[R]?.[C] ?? ''} in all`}>
        <div className="prob-grid-wrap">
          <table className="prob-grid" data-testid="prob-grid">
            <thead>
              <tr>
                <th />
                {t.cols.map((col, j) => (
                  <th key={j} className={j === t.b ? 'prob-on' : undefined}>
                    <TextField
                      value={col}
                      label={`column ${j + 1} label`}
                      testId="prob-col-label"
                      onCommit={(v) => v && setTable({ cols: t.cols.map((x, k) => (k === j ? v : x)) }, `rename ${col}`)}
                    />
                  </th>
                ))}
                <th className="prob-total">Total</th>
              </tr>
            </thead>
            <tbody>
              {t.rows.map((row, i) => (
                <tr key={i}>
                  <th className={i === t.a ? 'prob-on' : undefined}>
                    <TextField
                      value={row}
                      label={`row ${i + 1} label`}
                      testId="prob-row-label"
                      onCommit={(v) => v && setTable({ rows: t.rows.map((x, k) => (k === i ? v : x)) }, `rename ${row}`)}
                    />
                  </th>
                  {t.cols.map((_, j) => (
                    <td key={j} className={i === t.a && j === t.b ? 'prob-cell-on' : (t.given === 'B' ? j === t.b : i === t.a) ? 'prob-given' : undefined}>
                      {rel === 'count' ? (
                        <TextField
                          value={String(t.counts[i]?.[j] ?? 0)}
                          label={`count for ${row} and ${t.cols[j]}`}
                          testId="prob-count"
                          width="5ch"
                          max={8}
                          check={wholeCheck(MAX_COUNT)}
                          onCommit={(v) => setTable({ counts: t.counts.map((r, k) => (k === i ? r.map((x, l) => (l === j ? Number(v) : x)) : r.slice())) }, `count ${row}, ${t.cols[j]}`)}
                        />
                      ) : (
                        <Answer k={ak} what="the percentage">
                          <span className="prob-num">{c.cells[i][j]}</span>
                        </Answer>
                      )}
                    </td>
                  ))}
                  <td className="prob-total">{rel === 'row' || rel === 'count' ? c.cells[i][C] : <Answer k={ak} what="the total">{c.cells[i][C]}</Answer>}</td>
                </tr>
              ))}
              <tr className="prob-total-row">
                <th className="prob-total">Total</th>
                {t.cols.map((_, j) => (
                  <td key={j} className="prob-total">
                    {rel === 'col' || rel === 'count' ? c.cells[R][j] : <Answer k={ak} what="the total">{c.cells[R][j]}</Answer>}
                  </td>
                ))}
                <td className="prob-total prob-grand" data-testid="prob-grand">
                  {c.cells[R][C]}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="data-actions dp-actions">
          {R < MAX_DIM && (
            <button
              type="button"
              className="calc-chip"
              data-testid="prob-add-row"
              onClick={(e) => {
                e.stopPropagation()
                setTable({ rows: [...t.rows, `Row ${R + 1}`], counts: [...t.counts.map((r) => r.slice()), t.cols.map(() => 0)] }, 'add row')
              }}
            >
              + row
            </button>
          )}
          {R > MIN_DIM && (
            <button
              type="button"
              className="calc-chip"
              onClick={(e) => {
                e.stopPropagation()
                setTable({ rows: t.rows.slice(0, -1), counts: t.counts.slice(0, -1).map((r) => r.slice()), a: Math.min(t.a, R - 2) }, 'remove row')
              }}
            >
              − row
            </button>
          )}
          {C < MAX_DIM && (
            <button
              type="button"
              className="calc-chip"
              data-testid="prob-add-col"
              onClick={(e) => {
                e.stopPropagation()
                setTable({ cols: [...t.cols, `Column ${C + 1}`], counts: t.counts.map((r) => [...r, 0]) }, 'add column')
              }}
            >
              + column
            </button>
          )}
          {C > MIN_DIM && (
            <button
              type="button"
              className="calc-chip"
              onClick={(e) => {
                e.stopPropagation()
                setTable({ cols: t.cols.slice(0, -1), counts: t.counts.map((r) => r.slice(0, -1)), b: Math.min(t.b, C - 2) }, 'remove column')
              }}
            >
              − column
            </button>
          )}
          <button
            type="button"
            className="calc-chip"
            data-testid="prob-example-dep"
            title="Grade 9 / Grade 10 × plays a sport — not independent"
            onClick={(e) => {
              e.stopPropagation()
              setTable(cloneTable(EXAMPLE_TABLE), 'example table')
            }}
          >
            example
          </button>
          <button
            type="button"
            className="calc-chip"
            data-testid="prob-example-indep"
            title="The same question with independent events: 9/20 play a sport in each grade"
            onClick={(e) => {
              e.stopPropagation()
              setTable(cloneTable(EXAMPLE_TABLE_INDEPENDENT), 'independent example')
            }}
          >
            independent example
          </button>
        </div>
        <div className="field-hint">With this card selected, click a cell on the board: its row becomes A and its column B.</div>
      </CardSection>

      <CardSection kind="prob-events" title="Events" summary={`A = ${c.names.A}, B = ${c.names.B}`}>
        <div className="rr-givens prob-events">
          <label className="rr-given" onClick={stop}>
            <span className="calc-tag">A =</span>
            <select className="calc-select" aria-label="Event A (a row)" data-testid="prob-a" value={t.a} onChange={(e) => setTable({ a: Number(e.target.value) }, 'event A')}>
              {t.rows.map((r, i) => (
                <option key={i} value={i}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="rr-given" onClick={stop}>
            <span className="calc-tag">B =</span>
            <select className="calc-select" aria-label="Event B (a column)" data-testid="prob-b" value={t.b} onChange={(e) => setTable({ b: Number(e.target.value) }, 'event B')}>
              {t.cols.map((r, j) => (
                <option key={j} value={j}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Seg<'B' | 'A'>
          options={[
            { v: 'B', text: 'P(A | B)', title: 'Given B: the fraction of B’s outcomes (its column) that are also in A' },
            { v: 'A', text: 'P(B | A)', title: 'Given A: the fraction of A’s outcomes (its row) that are also in B' },
          ]}
          value={t.given}
          label="Conditional"
          testId="prob-given"
          onPick={(v) => setTable({ given: v }, v === 'B' ? 'P(A | B)' : 'P(B | A)')}
        />
        <Seg<RelView>
          options={[
            { v: 'count', text: 'Counts' },
            { v: 'joint', text: 'Joint %', title: 'Each cell over the grand total' },
            { v: 'row', text: 'Row %', title: 'Each cell over its row total: each row adds to 100%' },
            { v: 'col', text: 'Column %', title: 'Each cell over its column total: each column adds to 100%' },
          ]}
          value={rel}
          label="Show"
          testId="prob-rel"
          onPick={(v) => setTable({ rel: v }, v === 'count' ? 'counts' : `${v === 'joint' ? 'joint' : v === 'row' ? 'row' : 'column'} percentages`)}
        />
      </CardSection>

      <CardSection kind="prob-readouts" title="Probabilities" answerKey={ak} summary={c.conditional ? `${c.conditional.label} = ${c.conditional.frac}` : '—'}>
        <Answer k={ak} block what="the probabilities">
          <Lines lines={c.lines} testId="prob-lines" />
          {c.conditional && (
            <div className="prob-conditional" data-testid="prob-conditional">
              <div>
                <span className="uc-k">
                  {c.conditional.label} = {c.conditional.frac}
                </span>{' '}
                <span className="uc-dim">
                  {c.conditional.dec.startsWith('≈') ? c.conditional.dec : `= ${c.conditional.dec}`} ·{' '}
                  {c.conditional.pct}
                </span>
              </div>
              <div className="field-hint rr-sentence">{c.conditional.words}</div>
            </div>
          )}
        </Answer>
      </CardSection>

      {c.indep && (
        <CardSection kind="prob-indep" title="Independent?" answerKey={ak} summary={c.indep.independent ? 'independent' : 'not independent'}>
          <Answer k={ak} block what="the independence check">
            <div className="uc-facts" data-testid="prob-indep">
              <div className={`prob-verdict${c.indep.independent ? '' : ' prob-verdict-no'}`}>{c.indep.verdict}</div>
              <div className="field-hint">{c.indep.product}</div>
              {c.indep.close && (
                <div className="field-hint rr-sentence">
                  The two are close. Real data rarely match exactly, so in the population the events may be nearly independent — the
                  sample alone cannot say.
                </div>
              )}
            </div>
          </Answer>
          <div className="field-hint">A and B are independent exactly when P(A | B) = P(A), or equivalently P(A and B) = P(A)·P(B).</div>
        </CardSection>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Venn diagram
// ---------------------------------------------------------------------------

function VennBody({ p, card, ak, setVenn }: ProbCardProps & { ak: string; setVenn(patch: Partial<ProbVenn>, label: string): void }) {
  const v = p.venn
  const c = card.venn
  const letters = ['A', 'B', 'C'].slice(0, v.sets)
  return (
    <>
      <CardSection kind="prob-venn-regions" title="Regions" summary={`${v.sets} sets${v.fromTable ? ', from the table' : ''}`}>
        <Seg<'2' | '3'>
          options={[
            { v: '2', text: 'Two sets' },
            { v: '3', text: 'Three sets' },
          ]}
          value={String(v.sets) as '2' | '3'}
          label="Sets"
          testId="prob-sets"
          onPick={(s) =>
            setVenn(
              s === '3'
                ? { sets: 3, fromTable: false, regions: EXAMPLE_VENN3_REGIONS.slice() }
                : { sets: 2, regions: v.regions.slice(0, 4).length === 4 ? v.regions.slice(0, 4) : EXAMPLE_VENN.regions.slice() },
              s === '3' ? 'three sets' : 'two sets',
            )
          }
        />
        {v.sets === 2 && (
          <div className="uc-toggles">
            <label className="te-check" onClick={stop} title="A = the table’s event A row, B = its event B column">
              <input type="checkbox" checked={v.fromTable} data-testid="prob-from-table" onChange={() => setVenn({ fromTable: !v.fromTable }, v.fromTable ? 'own regions' : 'regions from the table')} />
              <span>from the two-way table</span>
            </label>
          </div>
        )}
        {!v.fromTable && (
          <>
            <div className="prob-names">
              {letters.map((l, i) => (
                <label key={l} className="rr-given" onClick={stop}>
                  <span className="calc-tag">{l} =</span>
                  <TextField value={v.names[i] ?? ''} label={`what ${l} stands for`} placeholder="(optional)" onCommit={(x) => setVenn({ names: [0, 1, 2].map((k) => (k === i ? x : (v.names[k] ?? ''))) }, `name ${l}`)} />
                </label>
              ))}
            </div>
            <div className="prob-regions" data-testid="prob-regions">
              {c.regionLabels.map((r) => (
                <label key={r.atom} className="rr-given prob-region" onClick={stop} title={r.set}>
                  <span className="calc-tag">{r.name}</span>
                  <TextField
                    value={v.regions[r.atom] ?? '0'}
                    label={`region ${r.set}`}
                    testId="prob-region"
                    width="6ch"
                    max={MAX_TEXT}
                    check={probCheck}
                    onCommit={(x) => setVenn({ regions: v.regions.map((y, k) => (k === r.atom ? x || '0' : y)) }, `region ${r.name}`)}
                  />
                </label>
              ))}
            </div>
          </>
        )}
        <div className="field-hint">{c.total} Counts, or probabilities (0.15, 3/20, 15%).</div>
        {c.warn && <div className="expr-error">{c.warn}</div>}
      </CardSection>

      <CardSection kind="prob-venn-event" title="Event" summary={c.event || '—'}>
        <TextField
          value={v.expr}
          label="Event to shade"
          testId="prob-expr"
          max={MAX_EXPR}
          className="prob-expr"
          placeholder="A ∩ Bᶜ"
          onCommit={(x) => setVenn({ expr: x }, 'event')}
        />
        <div className="data-actions dp-actions">
          {(v.sets === 2 ? VENN_CHIPS2 : VENN_CHIPS3).map((e) => (
            <button
              key={e}
              type="button"
              className={`calc-chip${c.event === e ? ' calc-chip-on' : ''}`}
              data-testid="prob-expr-chip"
              onClick={(ev) => {
                ev.stopPropagation()
                setVenn({ expr: e }, `shade ${e}`)
              }}
            >
              {e}
            </button>
          ))}
        </div>
        {c.error ? <div className="expr-error" data-testid="prob-expr-error">{c.error}</div> : <div className="field-hint">Shaded: {c.words}</div>}
        <div className="field-hint">Type ∪ ∩ ᶜ, or U n ', or and / or / not, with parentheses: A ∩ B&apos;, not (A or B).</div>
      </CardSection>

      {c.p && (
        <CardSection kind="prob-venn-p" title="Probability" answerKey={ak} summary={`P(${c.event}) = ${c.p.split(' ')[0]}`}>
          <Answer k={ak} block what="the probability">
            <div className="uc-facts" data-testid="prob-venn-p">
              <div>
                <span className="uc-k">
                  P({c.event}) = {c.p}
                </span>
              </div>
              <div className="field-hint">Sum of the shaded regions: {c.regions}</div>
              {c.rule && (
                <div className="prob-rule" data-testid="prob-rule">
                  <div>{c.rule}</div>
                  <div>{c.ruleNumbers}</div>
                </div>
              )}
            </div>
            {c.basics.length > 0 && <Lines lines={c.basics} testId="prob-venn-basics" />}
            {c.indep && <div className="field-hint rr-sentence">{c.indep}</div>}
          </Answer>
        </CardSection>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Tree diagram
// ---------------------------------------------------------------------------

function TreeBody({
  p,
  card,
  ak,
  setTree,
  rebuildTree,
}: ProbCardProps & { ak: string; setTree(patch: Partial<ProbTree>, label: string): void; rebuildTree(patch: Partial<ProbTree>, label: string): void }) {
  const t = p.tree
  const c = card.tree
  const [preset, setPreset] = useState('')
  const stages = t.stages
  const setStage = (i: number, next: ProbStage, label: string): void => rebuildTree({ stages: stages.map((s, k) => (k === i ? next : s)) }, label)
  /** Reshape every later stage's rows when an earlier stage's outcomes change. */
  const reshape = (list: ProbStage[]): ProbStage[] =>
    list.map((s, i) => {
      const nodes = s.same ? 1 : stageNodes(list, i)
      const probs = Array.from({ length: nodes }, (_, r) => s.outcomes.map((_, k) => s.probs[r]?.[k] ?? s.probs[0]?.[k] ?? ''))
      return { ...s, probs }
    })
  return (
    <>
      <CardSection kind="prob-tree-build" title="Build" summary={t.mode === 'bag' ? `${t.bag.map((b) => `${b.count} ${b.name}`).join(', ')} · ${t.draws} draws` : `${stages.length} stages`}>
        <Seg<'bag' | 'manual'>
          options={[
            { v: 'bag', text: 'From a bag', title: 'Counts per colour, the number of draws, with or without replacement' },
            { v: 'manual', text: 'Type the stages', title: 'Outcomes and probabilities stage by stage' },
          ]}
          value={t.mode}
          label="Tree"
          testId="prob-tree-mode"
          onPick={(v) => rebuildTree({ mode: v, stages: v === 'manual' && stages.length === 0 ? cloneTree(EXAMPLE_TREE).stages : stages, pick: [], event: undefined }, v === 'bag' ? 'tree from a bag' : 'typed tree')}
        />
        {t.mode === 'bag' ? (
          <>
            <div className="prob-bag" data-testid="prob-bag">
              {t.bag.map((b, i) => (
                <div key={i} className="prob-bag-row">
                  <TextField value={b.name} label={`colour ${i + 1}`} testId="prob-bag-name" onCommit={(v) => v && rebuildTree({ bag: t.bag.map((x, k) => (k === i ? { ...x, name: v } : x)) }, `rename ${b.name}`)} />
                  <TextField
                    value={String(b.count)}
                    label={`how many ${b.name}`}
                    testId="prob-bag-count"
                    width="4ch"
                    max={3}
                    check={wholeCheck(MAX_BAG)}
                    onCommit={(v) => rebuildTree({ bag: t.bag.map((x, k) => (k === i ? { ...x, count: Number(v) } : x)) }, `${v} ${b.name}`)}
                  />
                  {t.bag.length > 1 && (
                    <button
                      type="button"
                      className="calc-drop"
                      aria-label={`Remove ${b.name}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        rebuildTree({ bag: t.bag.filter((_, k) => k !== i) }, `remove ${b.name}`)
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              {t.bag.length < MAX_COLORS && (
                <button
                  type="button"
                  className="calc-chip"
                  data-testid="prob-bag-add"
                  onClick={(e) => {
                    e.stopPropagation()
                    const names = ['Red', 'Blue', 'Green', 'Yellow', 'White', 'Black']
                    const name = names.find((n) => !t.bag.some((b) => b.name === n)) ?? `Colour ${t.bag.length + 1}`
                    rebuildTree({ bag: [...t.bag, { name, count: 1 }] }, `add ${name}`)
                  }}
                >
                  + colour
                </button>
              )}
            </div>
            <Seg<string>
              options={Array.from({ length: MAX_DRAWS }, (_, i) => ({ v: String(i + 1), text: `${i + 1} draw${i === 0 ? '' : 's'}` }))}
              value={String(t.draws)}
              label="Draws"
              testId="prob-draws"
              onPick={(v) => rebuildTree({ draws: Number(v) }, `${v} draws`)}
            />
            <Seg<'no' | 'yes'>
              options={[
                { v: 'no', text: 'Without replacement', title: 'Dependent draws: one fewer left each time' },
                { v: 'yes', text: 'With replacement', title: 'Independent draws: the bag is the same each time' },
              ]}
              value={t.replace ? 'yes' : 'no'}
              label="Replacement"
              testId="prob-replace"
              onPick={(v) => setTree({ replace: v === 'yes', pick: t.pick, event: t.event }, v === 'yes' ? 'with replacement' : 'without replacement')}
            />
          </>
        ) : (
          <div className="prob-stages" data-testid="prob-stages">
            {stages.map((s, i) => {
              const nodes = s.same ? 1 : stageNodes(stages, i)
              return (
                <div key={i} className="prob-stage">
                  <div className="dp-set-head">
                    <TextField value={s.name} label={`stage ${i + 1} name`} onCommit={(v) => setStage(i, { ...s, name: v || `Stage ${i + 1}` }, 'rename stage')} />
                    {stages.length > 1 && (
                      <button
                        type="button"
                        className="calc-drop"
                        aria-label={`Remove ${s.name}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          rebuildTree({ stages: reshape(stages.filter((_, k) => k !== i)) }, 'remove stage')
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <label className="rr-given" onClick={stop}>
                    <span className="calc-tag">outcomes</span>
                    <TextField
                      value={s.outcomes.join(', ')}
                      label={`stage ${i + 1} outcomes`}
                      testId="prob-stage-outcomes"
                      max={120}
                      check={(v) => {
                        const n = v.split(',').map((x) => x.trim()).filter(Boolean).length
                        return n >= 2 && n <= MAX_TREE_OUTCOMES ? null : `2 to ${MAX_TREE_OUTCOMES} outcomes, separated by commas.`
                      }}
                      onCommit={(v) => {
                        const outcomes = v.split(',').map((x) => x.trim().slice(0, MAX_LABEL)).filter(Boolean)
                        rebuildTree({ stages: reshape(stages.map((x, k) => (k === i ? { ...x, outcomes } : x))) }, 'stage outcomes')
                      }}
                    />
                  </label>
                  {i > 0 && (
                    <label className="te-check" onClick={stop} title="Independent: the same probabilities whatever came before">
                      <input
                        type="checkbox"
                        checked={s.same}
                        data-testid="prob-stage-same"
                        onChange={() => rebuildTree({ stages: reshape(stages.map((x, k) => (k === i ? { ...x, same: !x.same } : x))) }, s.same ? 'dependent stage' : 'independent stage')}
                      />
                      <span>same probabilities after every outcome (independent)</span>
                    </label>
                  )}
                  <table className="stat-me prob-stage-probs">
                    <thead>
                      <tr>
                        <th />
                        {s.outcomes.map((o, k) => (
                          <th key={k}>{o}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: nodes }, (_, r) => (
                        <tr key={r}>
                          <td className="dp-label">{i === 0 || s.same ? 'P' : `after ${pathName(stages, i, r)}`}</td>
                          {s.outcomes.map((o, k) => (
                            <td key={k}>
                              <TextField
                                value={s.probs[r]?.[k] ?? ''}
                                label={`P(${o}) ${i === 0 || s.same ? '' : `after ${pathName(stages, i, r)}`}`}
                                testId="prob-stage-p"
                                width="5ch"
                                max={MAX_TEXT}
                                check={probCheck}
                                onCommit={(v) =>
                                  setStage(i, { ...s, probs: Array.from({ length: nodes }, (_, rr) => s.outcomes.map((_, kk) => (rr === r && kk === k ? v : (s.probs[rr]?.[kk] ?? '')))) }, `P(${o})`)
                                }
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })}
            {stages.length < MAX_TREE_STAGES && (
              <button
                type="button"
                className="calc-chip"
                data-testid="prob-add-stage"
                onClick={(e) => {
                  e.stopPropagation()
                  rebuildTree({ stages: reshape([...stages, { name: `Stage ${stages.length + 1}`, outcomes: ['Yes', 'No'], probs: [['1/2', '1/2']], same: true }]) }, 'add stage')
                }}
              >
                + stage
              </button>
            )}
          </div>
        )}
        {c.problems.length > 0 && (
          <div className="expr-error" data-testid="prob-tree-problems">
            {c.problems.join(' ')}
          </div>
        )}
        <div className="field-hint rr-sentence">{c.note}</div>
      </CardSection>

      <CardSection kind="prob-tree-event" title="Event" summary={c.event ? `P(${c.event.name})` : 'none picked'}>
        {c.presets.length > 0 && (
          <select
            className="calc-select"
            aria-label="A ready-made event"
            data-testid="prob-preset"
            value={preset}
            onClick={stop}
            onChange={(e) => {
              const pr = c.presets.find((x) => x.id === e.target.value)
              setPreset('')
              if (pr) setTree({ pick: sortKeys(pr.keys), event: pr.name }, `event ${pr.name}`)
            }}
          >
            <option value="">An event…</option>
            {c.presets.map((pr) => (
              <option key={pr.id} value={pr.id}>
                {pr.name}
              </option>
            ))}
          </select>
        )}
        <div className="prob-leaves" data-testid="prob-leaves">
          {c.leaves.map((l) => (
            <label key={l.key} className="te-check prob-leaf" onClick={stop} title={l.long}>
              <input
                type="checkbox"
                checked={l.picked}
                data-testid="prob-leaf"
                onChange={() => setTree({ pick: sortKeys(l.picked ? t.pick.filter((k) => k !== l.key) : [...t.pick, l.key]) }, l.picked ? `leave out ${l.short}` : `include ${l.short}`)}
              />
              <span className="prob-leaf-name">{l.short}</span>
              <Answer k={ak} what="the path probability" quiet>
                <span className="uc-dim">{l.p}</span>
              </Answer>
            </label>
          ))}
        </div>
        <div className="field-hint">With this card selected, click a leaf on the board to put it in or out of the event.</div>
      </CardSection>

      {c.leaves.length > 0 && (
        <CardSection kind="prob-tree-rule" title="Multiplication Rule" answerKey={ak} summary={`${c.leaves.length} paths`} defaultOpen={false}>
          <Answer k={ak} block what="the path products">
            <div className="uc-facts prob-rules" data-testid="prob-tree-rules">
              {c.leaves.map((l) => (
                <div key={l.key} className={l.picked ? 'prob-picked' : undefined}>
                  {l.rule}
                </div>
              ))}
            </div>
            <div className="field-hint">{c.total}</div>
          </Answer>
        </CardSection>
      )}

      {c.event && (
        <CardSection kind="prob-tree-p" title="Probability" answerKey={ak} summary={`P(${c.event.name}) = ${c.event.all.split(' ')[0]}`}>
          <Answer k={ak} block what="the probability">
            <div className="uc-facts" data-testid="prob-tree-p">
              <div>
                <span className="uc-k">
                  P({c.event.name}) = {c.event.terms}
                </span>
              </div>
              <div>= {c.event.numbers}</div>
              {c.event.complement && <div className="field-hint">or by the complement: = {c.event.complement}</div>}
              <div className="uc-dim">{c.event.all}</div>
            </div>
          </Answer>
        </CardSection>
      )}
    </>
  )
}

/** "H", "HT": the earlier outcomes leading to node r of stage i. */
function pathName(stages: readonly ProbStage[], i: number, r: number): string {
  const parts: string[] = []
  let rest = r
  for (let s = i - 1; s >= 0; s--) {
    const n = Math.max(1, stages[s].outcomes.length)
    parts.unshift(stages[s].outcomes[rest % n] ?? '?')
    rest = Math.floor(rest / n)
  }
  return parts.join(', ')
}

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Answer, AnswerTex, RevealPill, answerTextParts, useReveal } from './RevealAnswer'
import { statKey } from './reveal'
import { CardSection } from './CardSection'
import { Latex } from './Latex'
import { parseNumeric } from './numeric'
import { useInk } from './inkContext'
import type { BoardNormal, BoardSim, NormalCardData, SimCardData } from './statsLinks'
import { EXAMPLE_GROUP_A, EXAMPLE_GROUP_B, statOf, val } from './statsLinks'
import type { NormalMode } from '../core/stats'
import { parseNumberList } from '../core/stats'
import { MAX_N, MAX_REPS, MIN_REPS } from '../core/statsPersist'

// ============================================================================
// src/ui/StatsCard.tsx — the statistics objects in the sidebar list.
//
//   NORMAL       μ, σ (typed exactly); below / above / between / outside /
//                percentile; the bounds; P(a < X < b) = P(z₁ < Z < z₂) ≈ …
//                with the z-score working; the empirical rule and the z row
//   SIMULATION   population (normal, proportion, a pasted list), statistic,
//                n, number of samples, seed; ▶ builds the plot up; the
//                simulated mean and SD against σ/√n; margins of error at
//                90 / 95 / 99 % and the interval; or COMPARE TREATMENTS: two
//                pasted groups, re-randomised, the p-value and its sentence
//
// Nothing here computes anything: every string arrives from
// src/ui/statsLinks.ts, the same numbers the board draws.
// ============================================================================

const stop = (e: { stopPropagation(): void }): void => e.stopPropagation()

interface Shell {
  color: string
  hidden: boolean
  selected: boolean
  name: string
  testId: string
  summary: string
  answerKey: string
  onSelect(): void
  onDelete(): void
  onToggleVisible(): void
  onCycleColor(): void
  onZoom(): void
  children: ReactNode
}

/** The frame both cards share: head, ⋯ menu, the summary line, the body when selected. */
function CardShell(p: Shell) {
  const ink = useInk()
  const revealApi = useReveal()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: PointerEvent): void => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [menuOpen])
  const item = (label: string, run: () => void, extra = ''): JSX.Element => (
    <button
      type="button"
      role="menuitem"
      className={`card-menu-item${extra ? ` ${extra}` : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        setMenuOpen(false)
        run()
      }}
    >
      {label}
    </button>
  )
  const parts = answerTextParts(p.summary)
  return (
    <div
      className={`card field-card rr-card stat-card${p.selected ? ' card-selected' : ''}${p.hidden ? ' card-hidden' : ''}`}
      style={{ '--curve': ink(p.color) } as CSSProperties}
      role="group"
      aria-roledescription="card"
      tabIndex={0}
      aria-current={p.selected ? 'true' : undefined}
      aria-label={`${p.name}${p.hidden ? ', hidden' : ''}`}
      data-testid={p.testId}
      onClick={p.onSelect}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          p.onSelect()
        }
      }}
    >
      <div className="card-head">
        <button
          className="color-dot"
          style={{ background: ink(p.color) }}
          title="Change colour"
          aria-label="Change colour"
          onClick={(e) => {
            e.stopPropagation()
            p.onCycleColor()
          }}
        />
        <span className="model-name">{p.name}</span>
        {p.hidden && <span className="card-flag">hidden</span>}
        <div className="card-menu-wrap" ref={menuRef}>
          <button
            type="button"
            className={`card-menu-btn${menuOpen ? ' card-menu-btn-open' : ''}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`${p.name} menu`}
            title="More — hide, zoom to it, delete"
            onClick={(e) => {
              e.stopPropagation()
              p.onSelect()
              setMenuOpen((o) => !o)
            }}
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="card-menu" role="menu" onClick={stop}>
              {item(p.hidden ? 'Show' : 'Hide', p.onToggleVisible)}
              {item('Zoom to it', p.onZoom)}
              {item('Delete', p.onDelete, 'card-menu-danger')}
            </div>
          )}
        </div>
      </div>
      <div className="uc-summary" data-testid={`${p.testId}-summary`}>
        {revealApi.hidden(p.answerKey) && parts ? (
          <>
            {parts[0]} <RevealPill k={p.answerKey} />
          </>
        ) : (
          <Answer k={p.answerKey}>{p.summary}</Answer>
        )}
      </div>
      {p.selected && (
        <div className="card-body card-body-sections" onClick={stop}>
          {p.children}
        </div>
      )}
    </div>
  )
}

/** A typed number: Enter or blur commits, Escape abandons; exact input ("100 - 2*15", "1/3") welcome. */
function NumField({
  value,
  onCommit,
  width = '7ch',
  testId,
  label,
}: {
  value: number
  onCommit(v: number): string | null
  width?: string
  testId?: string
  label: string
}) {
  const [edit, setEdit] = useState<{ text: string; bad: string | null } | null>(null)
  const shown = String(Number(value.toPrecision(8)))
  const commit = (text: string): boolean => {
    const v = parseNumeric(text)
    if (v === null) {
      setEdit({ text, bad: 'Type a number.' })
      return false
    }
    const err = v === value ? null : onCommit(v)
    if (err) {
      setEdit({ text, bad: err })
      return false
    }
    setEdit(null)
    return true
  }
  return (
    <>
      <input
        className={`calc-input rr-input${edit?.bad ? ' fe-input-bad' : ''}`}
        style={{ width }}
        type="text"
        inputMode="decimal"
        spellCheck={false}
        autoComplete="off"
        aria-label={label}
        title={edit?.bad ?? undefined}
        data-testid={testId}
        value={edit ? edit.text : shown}
        onFocus={(e) => {
          setEdit({ text: shown, bad: null })
          e.currentTarget.select()
        }}
        onClick={stop}
        onChange={(e) => setEdit({ text: e.target.value, bad: null })}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            e.preventDefault()
            commit(edit?.text ?? shown)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            setEdit(null)
            e.currentTarget.blur()
          }
        }}
        onBlur={() => {
          if (!edit) return
          if (edit.text.trim() === shown || edit.bad) {
            setEdit(null)
            return
          }
          commit(edit.text)
        }}
      />
      {edit?.bad && <span className="expr-error stat-inline-error">{edit.bad}</span>}
    </>
  )
}

/** A pasted list of numbers: committed on blur (or ⌘/Ctrl+Enter). */
function ListField({
  values,
  onCommit,
  testId,
  label,
  placeholder,
}: {
  values: readonly number[]
  onCommit(v: number[]): void
  testId?: string
  label: string
  placeholder: string
}) {
  const shown = values.map((v) => String(v)).join(', ')
  const [text, setText] = useState<string | null>(null)
  const [bad, setBad] = useState<string | null>(null)
  const commit = (t: string): void => {
    const r = parseNumberList(t)
    if (r.bad.length > 0) {
      setBad(`Not numbers: ${r.bad.slice(0, 3).join(', ')}${r.bad.length > 3 ? ' …' : ''}`)
      return
    }
    setBad(null)
    setText(null)
    if (r.values.join(',') !== values.join(',')) onCommit(r.values)
  }
  return (
    <div className="stat-list" onClick={stop}>
      <textarea
        className={`stat-textarea${bad ? ' fe-input-bad' : ''}`}
        aria-label={label}
        data-testid={testId}
        rows={3}
        spellCheck={false}
        placeholder={placeholder}
        value={text ?? shown}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            commit(text ?? shown)
          } else if (e.key === 'Escape') {
            setText(null)
            setBad(null)
            e.currentTarget.blur()
          }
        }}
        onBlur={() => {
          if (text !== null) commit(text)
        }}
      />
      <div className="field-hint">
        {bad ? <span className="expr-error">{bad}</span> : `${values.length} value${values.length === 1 ? '' : 's'}`}
      </div>
    </div>
  )
}

function Seg<T extends string>({
  options,
  value,
  onPick,
  label,
  testId,
  disabled,
}: {
  options: readonly { v: T; text: string; title?: string }[]
  value: T
  onPick(v: T): void
  label: string
  testId: string
  disabled?: (v: T) => boolean
}) {
  return (
    <div className="seg stat-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          className={`seg-btn${value === o.v ? ' seg-on' : ''}`}
          aria-pressed={value === o.v}
          data-testid={`${testId}-${o.v}`}
          title={o.title}
          disabled={disabled ? disabled(o.v) : false}
          onClick={(e) => {
            e.stopPropagation()
            if (value !== o.v) onPick(o.v)
          }}
        >
          {o.text}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Normal distribution
// ---------------------------------------------------------------------------

export interface NormalCardProps {
  n: BoardNormal
  card: NormalCardData
  selected: boolean
  onSelect(): void
  onDelete(): void
  onToggleVisible(): void
  onCycleColor(): void
  onZoom(): void
  onPatch(patch: Partial<BoardNormal>, label: string): void
}

const MODES: readonly { v: NormalMode; text: string; title: string }[] = [
  { v: 'below', text: 'X < a', title: 'The area below a' },
  { v: 'above', text: 'X > a', title: 'The area above a' },
  { v: 'between', text: 'a < X < b', title: 'The area between a and b' },
  { v: 'outside', text: 'outside', title: 'The area below a and above b' },
  { v: 'percentile', text: 'percentile', title: 'Find the value for a percentile' },
]

export function NormalCard(props: NormalCardProps) {
  const { n, card } = props
  const ak = statKey(n.id)
  const two = n.mode === 'between' || n.mode === 'outside'
  return (
    <CardShell
      color={n.color}
      hidden={n.hidden === true}
      selected={props.selected}
      name="Normal distribution"
      testId="normal-card"
      summary={card.summary}
      answerKey={ak}
      onSelect={props.onSelect}
      onDelete={props.onDelete}
      onToggleVisible={props.onToggleVisible}
      onCycleColor={props.onCycleColor}
      onZoom={props.onZoom}
    >
      <CardSection kind="stat-normal-dist" title="Distribution" summary={`N(${val(n.mu)}, ${val(n.sigma)})`}>
        <div className="rr-givens">
          <label className="rr-given" onClick={stop} title="The mean">
            <span className="calc-tag">μ =</span>
            <NumField value={n.mu} label="mean μ" testId="normal-mu" onCommit={(v) => (props.onPatch({ mu: v }, `μ = ${val(v)}`), null)} />
          </label>
          <label className="rr-given" onClick={stop} title="The standard deviation">
            <span className="calc-tag">σ =</span>
            <NumField
              value={n.sigma}
              label="standard deviation σ"
              testId="normal-sigma"
              onCommit={(v) => (v > 0 ? (props.onPatch({ sigma: v }, `σ = ${val(v)}`), null) : 'σ must be positive.')}
            />
          </label>
        </div>
        <div className="field-hint">Drag the peak to move μ, a shoulder to change σ.</div>
      </CardSection>

      <CardSection kind="stat-normal-prob" title="Probability" summary={card.question} answerKey={ak}>
        <Seg options={MODES} value={n.mode} label="Shade" testId="normal-mode" onPick={(m) => props.onPatch({ mode: m }, `shade ${m}`)} />
        <div className="rr-givens">
          {n.mode === 'percentile' ? (
            <label className="rr-given" onClick={stop} title="The percent of the distribution below x">
              <span className="calc-tag">percentile</span>
              <NumField
                value={n.pct}
                label="percentile"
                testId="normal-pct"
                onCommit={(v) => (v > 0 && v < 100 ? (props.onPatch({ pct: v }, `${val(v)}th percentile`), null) : 'Between 0 and 100.')}
              />
              <span className="rr-unit">%</span>
            </label>
          ) : (
            <>
              <label className="rr-given" onClick={stop}>
                <span className="calc-tag">a =</span>
                <NumField value={n.a} label="bound a" testId="normal-a" onCommit={(v) => (props.onPatch({ a: v }, `a = ${val(v)}`), null)} />
              </label>
              {two && (
                <label className="rr-given" onClick={stop}>
                  <span className="calc-tag">b =</span>
                  <NumField value={n.b} label="bound b" testId="normal-b" onCommit={(v) => (props.onPatch({ b: v }, `b = ${val(v)}`), null)} />
                </label>
              )}
            </>
          )}
        </div>
        {card.probTex && (
          <div className="rr-tex stat-prob" data-testid="normal-prob">
            <AnswerTex k={ak} tex={`${card.probTex.question} \\approx ${card.probTex.answer}`} question={card.probTex.question} what="the probability" />
          </div>
        )}
        {card.zWork.length > 0 && (
          <Answer k={ak} block quiet>
            <div className="stat-work" data-testid="normal-zwork">
              {card.zWork.map((z, i) => (
                <div key={i} className="rr-tex">
                  <Latex tex={z.tex} />
                </div>
              ))}
            </div>
          </Answer>
        )}
        {card.percentile && (
          <div className="stat-work" data-testid="normal-percentile">
            <div className="rr-tex">
              <AnswerTex k={ak} tex={card.percentile.zTex} question={'z = \\text{invNorm}(' + val(n.pct / 100) + ')'} what="z" />
            </div>
            <Answer k={ak} block quiet>
              <div className="rr-tex">
                <Latex tex={card.percentile.xTex} />
              </div>
            </Answer>
          </div>
        )}
      </CardSection>

      <CardSection kind="stat-normal-show" title="Show" summary={[n.rule ? 'empirical rule' : '', n.zRow !== false ? 'z row' : ''].filter(Boolean).join(', ') || 'curve only'}>
        <div className="uc-toggles">
          <label className="te-check" onClick={stop} title="μ ± σ, 2σ, 3σ with 68%, 95%, 99.7%">
            <input type="checkbox" checked={n.rule === true} data-testid="normal-rule" onChange={() => props.onPatch({ rule: n.rule ? undefined : true }, n.rule ? 'hide empirical rule' : 'empirical rule')} />
            <span>empirical rule (68–95–99.7)</span>
          </label>
          <label className="te-check" onClick={stop} title="A row of z-scores under the raw values">
            <input type="checkbox" checked={n.zRow !== false} data-testid="normal-zrow" onChange={() => props.onPatch({ zRow: n.zRow === false ? undefined : false }, n.zRow === false ? 'z row' : 'no z row')} />
            <span>z-axis row</span>
          </label>
        </div>
        {n.rule && (
          <div className="uc-facts" data-testid="normal-rule-facts">
            {card.rule.map((r) => (
              <div key={r.k}>
                <span className="uc-k">{r.text}</span> between {r.lo} and {r.hi} <span className="uc-dim">(exactly {r.exact}%)</span>
              </div>
            ))}
          </div>
        )}
      </CardSection>
    </CardShell>
  )
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

export interface SimCardProps {
  s: BoardSim
  card: SimCardData
  selected: boolean
  playing: boolean
  onSelect(): void
  onDelete(): void
  onToggleVisible(): void
  onCycleColor(): void
  onZoom(): void
  onPatch(patch: Partial<BoardSim>, label: string): void
  onPlay(on: boolean): void
  onReseed(): void
}

const REPS = [100, 500, 1000, 2000, 5000, 10000] as const

export function SimCard(props: SimCardProps) {
  const { s, card } = props
  const ak = statKey(s.id)
  const sample = card.sample
  const cmp = card.compare
  return (
    <CardShell
      color={s.color}
      hidden={s.hidden === true}
      selected={props.selected}
      name={s.mode === 'compare' ? 'Compare treatments' : 'Sampling simulation'}
      testId="sim-card"
      summary={card.summary}
      answerKey={ak}
      onSelect={props.onSelect}
      onDelete={props.onDelete}
      onToggleVisible={props.onToggleVisible}
      onCycleColor={props.onCycleColor}
      onZoom={props.onZoom}
    >
      <Seg
        options={[
          { v: 'sample', text: 'Sampling', title: 'Repeated samples from a population' },
          { v: 'compare', text: 'Compare treatments', title: 'A randomisation test for two groups' },
        ]}
        value={s.mode}
        label="Simulation"
        testId="sim-mode"
        onPick={(m) =>
          props.onPatch(
            m === 'compare' && s.groupA.length === 0 && s.groupB.length === 0
              ? { mode: m, groupA: EXAMPLE_GROUP_A.slice(), groupB: EXAMPLE_GROUP_B.slice() }
              : { mode: m },
            m === 'compare' ? 'compare treatments' : 'sampling',
          )
        }
      />

      {s.mode === 'sample' ? (
        <CardSection kind="stat-sim-pop" title="Population" summary={s.pop === 'normal' ? `N(${val(s.mu)}, ${val(s.sigma)})` : s.pop === 'proportion' ? `p = ${val(s.p)}` : `${s.list.length} values`}>
          <Seg
            options={[
              { v: 'normal', text: 'Normal' },
              { v: 'proportion', text: 'Proportion' },
              { v: 'list', text: 'Paste a list' },
            ]}
            value={s.pop}
            label="Population"
            testId="sim-pop"
            onPick={(p) => props.onPatch({ pop: p }, `population: ${p}`)}
          />
          <div className="rr-givens">
            {s.pop === 'normal' && (
              <>
                <label className="rr-given" onClick={stop}>
                  <span className="calc-tag">μ =</span>
                  <NumField value={s.mu} label="population mean" testId="sim-mu" onCommit={(v) => (props.onPatch({ mu: v }, `μ = ${val(v)}`), null)} />
                </label>
                <label className="rr-given" onClick={stop}>
                  <span className="calc-tag">σ =</span>
                  <NumField value={s.sigma} label="population SD" testId="sim-sigma" onCommit={(v) => (v > 0 ? (props.onPatch({ sigma: v }, `σ = ${val(v)}`), null) : 'σ must be positive.')} />
                </label>
              </>
            )}
            {s.pop === 'proportion' && (
              <label className="rr-given" onClick={stop}>
                <span className="calc-tag">p =</span>
                <NumField value={s.p} label="population proportion" testId="sim-p" onCommit={(v) => (v >= 0 && v <= 1 ? (props.onPatch({ p: v }, `p = ${val(v)}`), null) : 'p is between 0 and 1.')} />
              </label>
            )}
          </div>
          {s.pop === 'list' && (
            <>
              <ListField values={s.list} label="population values" testId="sim-list" placeholder="Paste the population: 12, 15, 18 … (for a proportion, 1 = yes and 0 = no)" onCommit={(v) => props.onPatch({ list: v }, 'paste population')} />
              <Seg
                options={[
                  { v: 'mean', text: 'mean x̄' },
                  { v: 'proportion', text: 'proportion of 1s p̂' },
                ]}
                value={s.stat}
                label="Statistic"
                testId="sim-stat"
                onPick={(v) => props.onPatch({ stat: v }, `statistic: ${v}`)}
              />
            </>
          )}
          {s.pop !== 'list' && <div className="field-hint">Statistic: sample {statOf(s) === 'proportion' ? 'proportion p̂' : 'mean x̄'}</div>}
        </CardSection>
      ) : (
        <CardSection kind="stat-sim-groups" title="Groups" summary={`A: ${s.groupA.length} · B: ${s.groupB.length}`}>
          <div className="stat-group-label">Group A (treatment)</div>
          <ListField values={s.groupA} label="group A" testId="sim-group-a" placeholder="Paste group A's measurements" onCommit={(v) => props.onPatch({ groupA: v }, 'group A')} />
          <div className="stat-group-label">Group B (control)</div>
          <ListField values={s.groupB} label="group B" testId="sim-group-b" placeholder="Paste group B's measurements" onCommit={(v) => props.onPatch({ groupB: v }, 'group B')} />
          <button
            type="button"
            className="calc-chip"
            data-testid="sim-example"
            title="A plant-growth experiment (cm), ten plants per group"
            onClick={(e) => {
              e.stopPropagation()
              props.onPatch({ groupA: EXAMPLE_GROUP_A.slice(), groupB: EXAMPLE_GROUP_B.slice() }, 'example groups')
            }}
          >
            use the example
          </button>
          <Seg
            options={[
              { v: 'two', text: 'either way', title: '|A − B| at least as large as observed' },
              { v: 'upper', text: 'A − B ≥ obs', title: 'At least as large as observed' },
              { v: 'lower', text: 'A − B ≤ obs', title: 'At most the observed' },
            ]}
            value={s.tail}
            label="As extreme as"
            testId="sim-tail"
            onPick={(t) => props.onPatch({ tail: t }, `tail: ${t}`)}
          />
        </CardSection>
      )}

      <CardSection kind="stat-sim-run" title="Run" summary={`${s.mode === 'sample' ? `n = ${s.n} · ` : ''}${s.reps} ${s.mode === 'sample' ? 'samples' : 're-randomisations'} · seed ${s.seed}`}>
        <div className="rr-givens">
          {s.mode === 'sample' && (
            <label className="rr-given" onClick={stop} title="Sample size">
              <span className="calc-tag">n =</span>
              <NumField
                value={s.n}
                width="6ch"
                label="sample size n"
                testId="sim-n"
                onCommit={(v) => (Number.isInteger(v) && v >= 1 && v <= MAX_N ? (props.onPatch({ n: v }, `n = ${v}`), null) : `A whole number from 1 to ${MAX_N}.`)}
              />
            </label>
          )}
          <label className="rr-given" onClick={stop} title="How many samples (or re-randomisations)">
            <span className="calc-tag">{s.mode === 'sample' ? 'samples' : 'times'}</span>
            <select
              className="calc-select"
              aria-label="number of samples"
              data-testid="sim-reps"
              value={REPS.includes(s.reps as (typeof REPS)[number]) ? s.reps : ''}
              onClick={stop}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (v >= MIN_REPS && v <= MAX_REPS) props.onPatch({ reps: v }, `${v} samples`)
              }}
            >
              {!REPS.includes(s.reps as (typeof REPS)[number]) && <option value="">{s.reps}</option>}
              {REPS.map((r) => (
                <option key={r} value={r}>
                  {r.toLocaleString('en-US')}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mo-player rr-player">
          <button
            type="button"
            className="calc-chip mo-play"
            data-testid="sim-play"
            aria-label={props.playing ? 'Stop' : 'Play'}
            title={props.playing ? 'Show them all' : 'Build the plot up, sample by sample'}
            onClick={(e) => {
              e.stopPropagation()
              props.onPlay(!props.playing)
            }}
          >
            {props.playing ? '■' : '▶'}
          </button>
          <button
            type="button"
            className="calc-chip"
            data-testid="sim-reseed"
            title="Draw new samples (a new seed — the old one comes back with undo)"
            onClick={(e) => {
              e.stopPropagation()
              props.onReseed()
            }}
          >
            new samples
          </button>
          <span className="field-hint stat-seed" title="The same seed always gives the same samples">
            seed {s.seed}
          </span>
        </div>
        <Seg
          options={[
            { v: 'dots', text: 'Dot plot' },
            { v: 'hist', text: 'Histogram' },
          ]}
          value={s.plot}
          label="Plot"
          testId="sim-plot"
          onPick={(v) => props.onPatch({ plot: v }, v === 'hist' ? 'histogram' : 'dot plot')}
        />
        {s.mode === 'sample' && (
          <div className="uc-toggles">
            <label className="te-check" onClick={stop} title="The normal curve the sampling distribution approaches">
              <input type="checkbox" checked={s.theory !== false} data-testid="sim-theory" onChange={() => props.onPatch({ theory: s.theory === false ? undefined : false }, s.theory === false ? 'theory curve' : 'no theory curve')} />
              <span>theoretical sampling distribution</span>
            </label>
          </div>
        )}
      </CardSection>

      {card.error && <div className="expr-error">{card.error}</div>}

      {sample && (
        <CardSection kind="stat-sim-results" title="Results" summary={`mean ${sample.mean}, SD ${sample.sd}`} answerKey={ak}>
          <div className="uc-facts" data-testid="sim-results">
            <div>
              mean of the {sample.symbol}’s ={' '}
              <Answer k={ak} what="the mean">
                <span className="uc-k">{sample.mean}</span>
              </Answer>
              {sample.theoryCenter !== null && <span className="uc-dim"> (theory {sample.theoryCenter})</span>}
            </div>
            <div>
              SD of the {sample.symbol}’s ={' '}
              <Answer k={ak} what="the SD">
                <span className="uc-k">{sample.sd}</span>
              </Answer>
            </div>
          </div>
          {sample.theorySdTex && (
            <div className="rr-tex" data-testid="sim-theory-sd">
              <Latex tex={`\\text{theory: } \\sigma_{${sample.symbol === 'p̂' ? '\\hat p' : '\\bar x'}} = ${sample.theorySdTex}`} />
            </div>
          )}
          <div className="stat-me-head">
            Margin of error = z* × SD, about{' '}
            <label className="rr-given" onClick={stop} title={`The statistic of your sample — sample 1's unless you type one`}>
              <span className="calc-tag">{sample.symbol} =</span>
              <NumField value={sample.observed} label="your sample statistic" testId="sim-observed" onCommit={(v) => (props.onPatch({ observed: v }, 'sample statistic'), null)} />
            </label>
            <span className="uc-dim"> ({sample.observedFrom})</span>
          </div>
          <Answer k={ak} block what="the margins of error">
            <table className="stat-me" data-testid="sim-me">
              <thead>
                <tr>
                  <th>C</th>
                  <th>z*</th>
                  <th>ME</th>
                  <th>interval</th>
                </tr>
              </thead>
              <tbody>
                {sample.me.map((m) => (
                  <tr key={m.label}>
                    <td>{m.label}</td>
                    <td>{m.zStar}</td>
                    <td>{m.me}</td>
                    <td>
                      ({m.lo}, {m.hi})
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Answer>
        </CardSection>
      )}

      {cmp && (
        <CardSection kind="stat-sim-compare" title="Result" summary={`p ${cmp.p}`} answerKey={ak}>
          <div className="uc-facts" data-testid="sim-compare">
            <div>
              mean A = {cmp.meanA}, mean B = {cmp.meanB}
            </div>
            <div>
              observed difference A − B = <span className="uc-k">{cmp.observed}</span>
            </div>
            <div>
              p-value{' '}
              <Answer k={ak} what="the p-value">
                <span className="uc-k" data-testid="sim-p-value">
                  {cmp.p}
                </span>{' '}
                <span className="uc-dim">
                  ({cmp.extreme} of {cmp.reps})
                </span>
              </Answer>
            </div>
          </div>
          <Answer k={ak} block quiet>
            <div className="field-hint rr-sentence" data-testid="sim-sentence">
              {cmp.sentence} {cmp.conclusion}
            </div>
          </Answer>
        </CardSection>
      )}
    </CardShell>
  )
}

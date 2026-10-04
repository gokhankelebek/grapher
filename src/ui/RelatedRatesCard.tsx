import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Answer, AnswerTex, RevealPill, useReveal } from './RevealAnswer'
import { maskAnswerText, rrKey } from './reveal'
import { CardSection } from './CardSection'
import { Latex } from './Latex'
import { parseNumeric } from './numeric'
import type { BoardRelatedRates, RelatedRatesCardData, RRSpeed } from './relatedRatesLinks'
import { RR_SPEEDS } from './relatedRatesLinks'
import { RR_DEFS, RR_SCENARIOS, dec, decExact } from '../core/relatedRates'
import type { RRScenario } from '../core/relatedRates'
import { useInk } from './inkContext'

// ============================================================================
// src/ui/RelatedRatesCard.tsx — the related-rates object in the sidebar list.
//
//   SCENARIO   ladder · cone · shadow · ripple · balloon
//   GIVENS     L, dx/dt, x₀ … typed exactly (fill / drain for the cone)
//   RELATION   the equation, its derivative with respect to t, the solved
//              rate — and the instant's numbers substituted into it
//   INSTANT    Play (0.5× / 1× / 2×), the t slider, "when x = 6" (solves t)
//              and "pause there"; the live quantities
//   ANSWER     dy/dt = −3/2 ft/s, exact when it is, in the AP sentence
//
// Nothing here computes anything: every string arrives from
// src/ui/relatedRatesLinks.ts, the same numbers the board draws.
// ============================================================================

interface Props {
  rr: BoardRelatedRates
  card: RelatedRatesCardData
  selected: boolean
  playing: boolean
  speed: RRSpeed
  onSelect(): void
  onDelete(): void
  onToggleVisible(): void
  onCycleColor(): void
  onZoom(): void
  onScenario(s: RRScenario): void
  /** New values for some givens (one undo). */
  onParams(patch: Record<string, number>): void
  /** `live`: the slider in flight — one undo for the whole drag. */
  onT(t: number, live: boolean): void
  onTEnd(): void
  onWhen(when: { q: string; v: number } | null): void
  onPause(on: boolean): void
  onGraph(on: boolean): void
  onPlay(on: boolean): void
  onSpeed(s: RRSpeed): void
}

const SHORT: Record<RRScenario, string> = {
  ladder: 'Ladder',
  cone: 'Cone',
  shadow: 'Shadow',
  ripple: 'Ripple',
  balloon: 'Balloon',
}

export function RelatedRatesCard(props: Props) {
  const ink = useInk()
  const { rr, card, selected, playing, speed } = props
  const def = card.def
  /** Reveal mode: the unknown rate (and any rate derived from it) is one answer. */
  const revealApi = useReveal()
  const ak = rrKey(rr.id)
  const answerLabels = def.extra ? [def.unknown.label, def.extra.label] : [def.unknown.label]
  const visible = rr.hidden !== true
  const stop = (e: { stopPropagation(): void }): void => e.stopPropagation()

  // ---- ⋯ menu
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
  const menuItem = (label: string, run: () => void, extra = ''): JSX.Element => (
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

  // ---- typed numbers: one field at a time
  const [edit, setEdit] = useState<{ key: string; text: string; bad: string | null } | null>(null)
  const field = (key: string, value: number, commit: (v: number) => string | null, width = '7ch', testId?: string): JSX.Element => (
    <input
      className={`calc-input rr-input${edit?.key === key && edit.bad ? ' fe-input-bad' : ''}`}
      style={{ width }}
      type="text"
      inputMode="decimal"
      spellCheck={false}
      autoComplete="off"
      data-testid={testId}
      value={edit?.key === key ? edit.text : String(Number(value.toPrecision(6)))}
      onFocus={(e) => {
        setEdit({ key, text: String(Number(value.toPrecision(6))), bad: null })
        e.currentTarget.select()
      }}
      onClick={stop}
      onChange={(e) => setEdit({ key, text: e.target.value, bad: null })}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          const v = parseNumeric(edit?.key === key ? edit.text : '')
          if (v === null) {
            setEdit({ key, text: edit?.text ?? '', bad: 'Type a number.' })
            return
          }
          const err = commit(v)
          if (err) setEdit({ key, text: edit?.text ?? '', bad: err })
          else setEdit(null)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          setEdit(null)
          e.currentTarget.blur()
        }
      }}
      onBlur={() => {
        if (edit?.key !== key) return
        const v = parseNumeric(edit.text)
        if (v !== null && v !== value && !edit.bad) {
          const err = commit(v)
          if (err) {
            setEdit({ ...edit, bad: err })
            return
          }
        }
        setEdit(null)
      }}
    />
  )

  const commitParam = (key: string) => (v: number): string | null => {
    const d = def.params.find((p) => p.key === key)
    if (!d) return null
    if (v < d.min || v > d.max) return `${d.label} must be between ${d.min} and ${d.max}.`
    if (!d.signed && v < 0) return `${d.label} cannot be negative.`
    props.onParams({ [key]: v })
    return null
  }

  // ---- the when-question
  const [whenQ, setWhenQ] = useState<string>(rr.when?.q ?? def.defaultWhen.q)
  useEffect(() => {
    setWhenQ(rr.when?.q ?? def.defaultWhen.q)
  }, [rr.scenario, rr.when?.q, def.defaultWhen.q])
  const whenValue = rr.when && rr.when.q === whenQ ? rr.when.v : def.defaultWhen.q === whenQ ? def.defaultWhen.v : 0

  const s = card.state
  const tStep = card.tMax / 400

  return (
    <div
      className={`card field-card rr-card${selected ? ' card-selected' : ''}${visible ? '' : ' card-hidden'}`}
      style={{ '--curve': ink(rr.color) } as CSSProperties}
      role="group"
      aria-roledescription="card"
      tabIndex={0}
      aria-current={selected ? 'true' : undefined}
      aria-label={`Related rates: ${def.title}${visible ? '' : ', hidden'}`}
      data-testid="rr-card"
      onClick={props.onSelect}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          props.onSelect()
        }
      }}
    >
      <div className="card-head">
        <button
          className="color-dot"
          style={{ background: ink(rr.color) }}
          title="Change color"
          aria-label="Change color"
          onClick={(e) => {
            e.stopPropagation()
            props.onCycleColor()
          }}
        />
        <span className="model-name">Related rates</span>
        {!visible && <span className="card-flag">hidden</span>}
        <div className="card-menu-wrap" ref={menuRef}>
          <button
            type="button"
            className={`card-menu-btn${menuOpen ? ' card-menu-btn-open' : ''}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Related rates menu"
            title="More — hide, zoom to it, delete"
            onClick={(e) => {
              e.stopPropagation()
              props.onSelect()
              setMenuOpen((o) => !o)
            }}
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="card-menu" role="menu" onClick={stop}>
              {menuItem(visible ? 'Hide' : 'Show', props.onToggleVisible)}
              {menuItem('Zoom to it', props.onZoom)}
              {menuItem('Delete', props.onDelete, 'card-menu-danger')}
            </div>
          )}
        </div>
      </div>

      <div className="uc-summary" data-testid="rr-summary">
        {revealApi.hidden(ak) ? (
          <>
            {maskAnswerText(card.summary, answerLabels)} <RevealPill k={ak} what={def.unknown.label} />
          </>
        ) : (
          <Answer k={ak}>{card.summary}</Answer>
        )}
      </div>

      {selected && (
        <div className="card-body card-body-sections" onClick={stop}>
          <CardSection kind="rr-scenario" title="Scenario" summary={def.title}>
            <div className="seg rr-scenarios" role="group" aria-label="Scenario">
              {RR_SCENARIOS.map((sc) => (
                <button
                  key={sc}
                  type="button"
                  className={`seg-btn${rr.scenario === sc ? ' seg-on' : ''}`}
                  aria-pressed={rr.scenario === sc}
                  data-testid={`rr-sc-${sc}`}
                  title={RR_DEFS[sc].stem}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (rr.scenario !== sc) props.onScenario(sc)
                  }}
                >
                  {SHORT[sc]}
                </button>
              ))}
            </div>
            <div className="field-hint rr-stem">{def.stem}</div>
          </CardSection>

          <CardSection
            kind="rr-givens"
            title="Givens"
            summary={def.params.map((d) => `${d.label} = ${Number(rr.params[d.key].toPrecision(6))}`).join(', ')}
          >
            <div className="rr-givens">
              {def.params.map((d) => (
                <label key={d.key} className="rr-given" title={d.name} onClick={stop}>
                  <span className="calc-tag">{d.label} =</span>
                  {field(`p:${d.key}`, rr.params[d.key], commitParam(d.key), '7ch', `rr-p-${d.key}`)}
                  <span className="rr-unit">{d.unit}</span>
                </label>
              ))}
            </div>
            {rr.scenario === 'cone' && (
              <div className="seg rr-flow" role="group" aria-label="Fill or drain">
                {(['fill', 'drain'] as const).map((m) => {
                  const on = m === 'fill' ? rr.params.k >= 0 : rr.params.k < 0
                  return (
                    <button
                      key={m}
                      type="button"
                      className={`seg-btn${on ? ' seg-on' : ''}`}
                      aria-pressed={on}
                      data-testid={`rr-${m}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (on) return
                        // Draining starts from a full-ish tank; filling from a little water.
                        const k = Math.abs(rr.params.k) || 3
                        const H = rr.params.H
                        const h0 = rr.params.h0
                        props.onParams(
                          m === 'drain'
                            ? { k: -k, ...(h0 < 0.5 * H ? { h0: 0.9 * H } : {}) }
                            : { k, ...(h0 > 0.5 * H ? { h0: 0.125 * H } : {}) },
                        )
                      }}
                    >
                      {m}
                    </button>
                  )
                })}
              </div>
            )}
            {edit?.bad && <div className="expr-error">{edit.bad}</div>}
          </CardSection>

          <CardSection kind="rr-relation" title="Relation" summary={def.relation.text}>
            <div className="rr-tex" data-testid="rr-relation" title={def.relation.text}>
              <Latex tex={def.relation.tex} />
            </div>
            {card.relationWith.text !== def.relation.text && (
              <div className="rr-tex rr-dim" title={card.relationWith.text}>
                <Latex tex={card.relationWith.tex} />
              </div>
            )}
            <div className="rr-step">d/dt of both sides:</div>
            <div className="rr-tex" data-testid="rr-derivative" title={def.derivative.text}>
              <Latex tex={def.derivative.tex} />
            </div>
            <div className="rr-step">solve for {def.unknown.label}:</div>
            <div className="rr-tex" data-testid="rr-solved" title={def.solved.text}>
              <Latex tex={def.solved.tex} />
            </div>
            {def.extraSolved && (
              <div className="rr-tex" title={def.extraSolved.text}>
                <Latex tex={def.extraSolved.tex} />
              </div>
            )}
          </CardSection>

          <CardSection kind="rr-instant" title="Instant" summary={`t = ${decExact(s.t, 2)} ${def.timeUnit}`}>
            <div className="mo-player rr-player">
              <button
                type="button"
                className="calc-chip mo-play"
                data-testid="rr-play"
                aria-label={playing ? 'Pause' : 'Play'}
                title={playing ? 'Pause' : 'Play the motion in time'}
                onClick={(e) => {
                  e.stopPropagation()
                  props.onPlay(!playing)
                }}
              >
                {playing ? '⏸' : '▶'}
              </button>
              <div className="seg mo-speed" role="group" aria-label="Speed">
                {RR_SPEEDS.map((sp) => (
                  <button
                    key={sp}
                    type="button"
                    className={`seg-btn${speed === sp ? ' seg-on' : ''}`}
                    aria-pressed={speed === sp}
                    onClick={(e) => {
                      e.stopPropagation()
                      props.onSpeed(sp)
                    }}
                  >
                    {sp}×
                  </button>
                ))}
              </div>
            </div>
            <div className="rr-trow">
              <span className="calc-tag">t =</span>
              <input
                type="range"
                className="rr-slider"
                data-testid="rr-t-slider"
                aria-label="t"
                min={0}
                max={card.tMax}
                step={tStep}
                value={s.t}
                onClick={stop}
                onChange={(e) => props.onT(Number(e.target.value), true)}
                onPointerUp={props.onTEnd}
                onKeyUp={props.onTEnd}
              />
              {field(
                't',
                s.t,
                (v) => {
                  if (v < 0 || v > card.tMax + 1e-9) return `t runs from 0 to ${dec(card.tMax, 2)} ${def.timeUnit}.`
                  props.onT(v, false)
                  return null
                },
                '6ch',
                'rr-t',
              )}
              <span className="rr-unit">{def.timeUnit}</span>
            </div>
            <div className="rr-when">
              <span className="calc-tag">when</span>
              <select
                className="calc-select"
                aria-label="Quantity"
                data-testid="rr-when-q"
                value={whenQ}
                onClick={stop}
                onChange={(e) => setWhenQ(e.target.value)}
              >
                {def.quantities.map((q) => (
                  <option key={q.key} value={q.key}>
                    {q.label}
                  </option>
                ))}
              </select>
              <span className="calc-tag">=</span>
              {field(
                `when:${whenQ}`,
                whenValue,
                (v) => {
                  props.onWhen({ q: whenQ, v })
                  return null
                },
                '6ch',
                'rr-when-v',
              )}
              <span className="rr-unit">{def.quantities.find((q) => q.key === whenQ)?.unit}</span>
              <button
                type="button"
                className="calc-chip"
                data-testid="rr-when-go"
                title="Find the instant"
                onClick={(e) => {
                  e.stopPropagation()
                  props.onWhen({ q: whenQ, v: whenValue })
                }}
              >
                go
              </button>
            </div>
            {card.when && !card.when.ok && <div className="expr-error">{card.when.error}.</div>}
            {card.when && card.when.ok && card.when.t !== null && (
              <div className="field-hint" data-testid="rr-when-t">
                {`${def.quantities.find((q) => q.key === card.when!.q)?.label} = ${Number(card.when.v.toPrecision(6))} at t = ${decExact(card.when.t, 3)} ${def.timeUnit}`}
              </div>
            )}
            <div className="uc-toggles">
              <label className="te-check" onClick={stop} title="Play stops at the “when” instant">
                <input
                  type="checkbox"
                  checked={rr.pause === true}
                  data-testid="rr-pause"
                  disabled={!rr.when}
                  onChange={() => props.onPause(!rr.pause)}
                />
                <span>pause at that instant</span>
              </label>
              <label className="te-check" onClick={stop} title={`A small graph of ${def.unknown.label} against t beside the picture`}>
                <input
                  type="checkbox"
                  checked={rr.graph !== false}
                  data-testid="rr-graph"
                  onChange={() => props.onGraph(rr.graph === false)}
                />
                <span>graph of {def.unknown.label}</span>
              </label>
            </div>
            <div className="uc-facts rr-values" data-testid="rr-values">
              {card.quantities.map((q) => (
                <div key={q.key}>
                  <span className="uc-k">{q.label}</span> = {q.text}
                </div>
              ))}
            </div>
          </CardSection>

          <CardSection
            kind="rr-answer"
            title="Answer"
            summary={card.unknown ? `${card.unknown.label} = ${card.unknown.text}` : '—'}
            answerKey={ak}
          >
            {card.unknown ? (
              <>
                {card.substituted && (
                  <div className="rr-tex" title={card.substituted.text}>
                    <AnswerTex
                      k={ak}
                      tex={`${card.substituted.tex} = ${card.unknown.tex}`}
                      question={card.substituted.tex}
                      what={def.unknown.label}
                    />
                  </div>
                )}
                <div className="rr-answer" data-testid="rr-answer">
                  {card.unknown.label} ={' '}
                  <Answer k={ak} what={card.unknown.label}>
                    <span className="uc-k">{card.unknown.text}</span> {card.unknown.unit}
                    {card.unknown.exact && card.unknown.text !== card.unknown.decimal && (
                      <span className="uc-dim"> ≈ {card.unknown.decimal}</span>
                    )}
                  </Answer>
                </div>
                {card.extra && (
                  <div className="rr-answer rr-answer-2" data-testid="rr-extra">
                    {card.extra.label} ={' '}
                    <Answer k={ak} what={card.extra.label}>
                      <span className="uc-k">{card.extra.text}</span> {card.extra.unit}
                    </Answer>
                  </div>
                )}
                {card.answer && (
                  <Answer k={ak} block quiet>
                    <div className="field-hint rr-sentence">{card.answer}</div>
                  </Answer>
                )}
              </>
            ) : (
              <div className="expr-error">The model has no value at this instant.</div>
            )}
          </CardSection>
        </div>
      )}
    </div>
  )
}

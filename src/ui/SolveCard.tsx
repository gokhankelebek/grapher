// ============================================================================
// src/ui/SolveCard.tsx — the card of a SOLVED inequality on the number line.
//
//   ● x² − 4 > 0                                         ⧉  ×
//     Solution  (−∞, −2) ∪ (2, ∞)
//     Set-builder  {x | x < −2 or x > 2}
//     [sign row] [test points] [distance] [stacked]   Show on graph
//   ▸ Show working                                    Copy as text
//       1. h(x) = x² − 4; solve h(x) > 0
//       2. Domain of h: all real numbers
//       3. Critical values: x = −2 (h = 0), x = 2 (h = 0)
//       4. interval | test point | h(t) | sign | ✓/✗
//       …the conclusion sentence
//
// Everything shown is recomputed from the item's source line (nlSolve.ts);
// the card edits only the line, the display flags, the label and the bar.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { NLSolveItem, NLSolveShow } from '../core/types'
import type { CurveStyle } from '../core/persist'
import { NL_BAR_WIDTH, NL_MAX_BAR_WIDTH, NL_MIN_BAR_WIDTH } from '../render/numberline'
import { Latex } from './Latex'
import { Answer } from './RevealAnswer'
import { solveKey } from './reveal'
import { CardSection } from './CardSection'
import {
  builderTex,
  builderText,
  graphSources,
  inputTex,
  routeOf,
  solveCached,
  solveShow,
  workingSteps,
  workingText,
} from './nlSolve'
import { useInk } from './inkContext'
import { equationLabel } from '../core/mathSpeech'

interface Props {
  item: NLSolveItem
  style: CurveStyle | undefined
  selected: boolean
  onSelect(): void
  onDelete(): void
  onCycleColor(): void
  onLabel(label: string): void
  /** Retype the inequality. The solver's error to show, or null. */
  onEquationCommit(src: string): string | null
  onShow(patch: NLSolveShow): void
  /** Put the picture on the Graph board. An error to show, or null. */
  onShowOnGraph(): string | null
  onWidth(width: number): void
  onStyleEditStart(): void
  onStyleEditEnd(): void
}

/** Clipboard, with the legacy path for a WebView that refuses the API. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    return true
  } catch {
    return false
  }
}

function fillStyle(value: number, min: number, max: number): CSSProperties {
  const span = max - min || 1
  const pct = Math.max(0, Math.min(100, ((value - min) / span) * 100))
  return { '--fill': `${pct}%` } as CSSProperties
}

/** The source line with the solver's position marked, for an inline error. */
function MarkedSource({ src, pos }: { src: string; pos?: number }) {
  if (pos === undefined || !(pos >= 0) || pos > src.length) return <code className="solve-src">{src}</code>
  const at = src.slice(pos, pos + 1) || ' '
  return (
    <code className="solve-src">
      {src.slice(0, pos)}
      <mark className="solve-src-at" title={`character ${pos + 1}`}>
        {at}
      </mark>
      {src.slice(pos + 1)}
    </code>
  )
}

export function SolveCard({
  item,
  style,
  selected,
  onSelect,
  onDelete,
  onCycleColor,
  onLabel,
  onEquationCommit,
  onShow,
  onShowOnGraph,
  onWidth,
  onStyleEditStart,
  onStyleEditEnd,
}: Props) {
  const ink = useInk()
  const outcome = useMemo(() => solveCached(item.src), [item.src])
  const result = outcome.ok ? outcome : null
  const show = solveShow(item)
  const steps = useMemo(() => (result ? workingSteps(result) : []), [result])
  // An equation solved the way a class does it: square, clear denominators,
  // combine logs, take logarithms — with every candidate checked.
  const route = useMemo(() => routeOf(item.src, result), [item.src, result])
  const compound = !!result && result.combine !== 'single' && result.clauses.length > 1
  const hasDistance = !!result && result.clauses.some((c) => c.distance !== null)
  const plan = useMemo(() => graphSources(item.src), [item.src])
  const canGraph = !!result && (result.variable || 'x') === 'x' && plan !== null
  const bothSides = !!plan && plan.length === 2 && plan.every((g) => !g.signChart) && !!result && result.clauses.length === 1 && result.clauses[0].relation === '='

  const [eqEdit, setEqEdit] = useState<{ text: string; error: string | null } | null>(null)
  const eqInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (eqEdit) {
      eqInputRef.current?.focus()
      eqInputRef.current?.select()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eqEdit !== null])
  const commitEqEdit = (): void => {
    if (!eqEdit) return
    const err = onEquationCommit(eqEdit.text)
    if (err) setEqEdit({ ...eqEdit, error: err })
    else setEqEdit(null)
  }

  const [labelDraft, setLabelDraft] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [graphError, setGraphError] = useState<string | null>(null)
  const copyTimer = useRef(0)
  useEffect(() => () => window.clearTimeout(copyTimer.current), [])

  const copyWorking = (): void => {
    if (!result) return
    void copyText(workingText(item.src, result)).then((ok) => {
      setCopied(ok)
      window.clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout(() => setCopied(false), 1600)
    })
  }

  const chip = (key: keyof NLSolveShow, label: string, title: string) => (
    <button
      type="button"
      key={key}
      className={`calc-chip${show[key] ? ' calc-chip-on' : ''}`}
      aria-pressed={show[key]}
      title={title}
      data-testid={`solve-toggle-${key}`}
      onClick={(e) => {
        e.stopPropagation()
        onShow({ [key]: !show[key] })
      }}
    >
      {label}
    </button>
  )

  return (
    <div
      className={`card nl-card solve-card${selected ? ' card-selected' : ''}`}
      role="group"
      aria-roledescription="card"
      tabIndex={0}
      aria-current={selected ? 'true' : undefined}
      aria-label={`Inequality ${item.src}`}
      data-item-id={item.id}
      data-testid="solve-card"
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
    >
      <div className="card-head">
        <button
          className="color-dot"
          style={{ background: ink(item.color) }}
          title="Change colour"
          aria-label="Change item colour"
          onClick={(e) => {
            e.stopPropagation()
            onCycleColor()
          }}
        />
        {eqEdit ? (
          <input
            ref={eqInputRef}
            className={`expr-input card-formula-input${eqEdit.error ? ' expr-input-bad' : ''}`}
            type="text"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            aria-label="Inequality"
            aria-invalid={eqEdit.error ? true : undefined}
            value={eqEdit.text}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setEqEdit({ text: e.target.value, error: null })}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') {
                e.preventDefault()
                commitEqEdit()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setEqEdit(null)
              }
            }}
            onBlur={() => setEqEdit(null)}
          />
        ) : (
          <button
            type="button"
            className="card-formula card-formula-btn"
            title="Click to retype the inequality"
            aria-label={result ? equationLabel(inputTex(result), 'Inequality') : `Inequality: ${item.src}`}
            onClick={(e) => {
              e.stopPropagation()
              onSelect()
              setEqEdit({ text: item.src, error: null })
            }}
          >
            {result ? <Latex tex={inputTex(result)} className="card-latex" /> : <span className="solve-raw">{item.src}</span>}
          </button>
        )}
        {!eqEdit && result && (
          <button
            className={`icon-btn nl-copy${copied ? ' nl-copy-done' : ''}`}
            data-testid="solve-copy-working"
            title="Copy the working as text"
            aria-label="Copy the working as text"
            onClick={(e) => {
              e.stopPropagation()
              copyWorking()
            }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              {copied ? (
                <path d="M3.2 8.6l3 3 6.6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              ) : (
                <>
                  <rect x="5.2" y="5.2" width="8.3" height="8.3" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
                  <path
                    d="M10.8 5.2V4a1.6 1.6 0 0 0-1.6-1.6H4A1.6 1.6 0 0 0 2.4 4v5.2A1.6 1.6 0 0 0 4 10.8h1.2"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </>
              )}
            </svg>
          </button>
        )}
        {!eqEdit && (
          <button
            className="icon-btn del"
            title="Delete this item (Del)"
            aria-label="Delete item"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      {eqEdit && (
        <div className="card-eq-foot" onClick={(e) => e.stopPropagation()}>
          {eqEdit.error && <div className="expr-error">{eqEdit.error}</div>}
          <div className="expr-hint">
            Enter saves · Esc cancels · try “x^2 - 4 &gt; 0”, “|2x - 3| &lt; 5”, “sqrt(x+7) = x - 5”
          </div>
        </div>
      )}

      {!result && !outcome.ok && (
        <div className="solve-error" role="alert" data-testid="solve-error">
          <div className="expr-error">{outcome.error}</div>
          {outcome.pos !== undefined && <MarkedSource src={item.src} pos={outcome.pos} />}
        </div>
      )}

      {result && (
        <div className="solve-answer" data-testid="solve-answer">
          <div className="solve-row">
            <span className="solve-tag">Solution</span>
            <Answer k={solveKey(item.id)} what="the solution set">
              <Latex tex={result.solution.tex} className="solve-tex" />
            </Answer>
          </div>
          <Answer k={solveKey(item.id)} block quiet>
            <div className="solve-row" title={builderText(result.solution, result.variable || 'x')}>
              <span className="solve-tag">Set-builder</span>
              <Latex tex={builderTex(result.solution, result.variable || 'x')} className="solve-tex" />
            </div>
          </Answer>
        </div>
      )}

      {result && route && (
        <div onClick={(e) => e.stopPropagation()}>
          <CardSection
            kind="nl-route"
            title={route.kind === 'exp' ? 'Exact form' : 'Algebraic route'}
            titleHint={
              route.kind === 'exp'
                ? 'Isolate the power and take logarithms: the exact solution, and the same number written with ln'
                : 'Solve the way it is done by hand, then check every candidate in the original equation: squaring, clearing denominators and combining logs can add extraneous solutions'
            }
            summary={route.summary}
            answerKey={solveKey(item.id)}
            className="solve-route"
            testId="solve-route"
          >
            <Answer k={solveKey(item.id)} block what="the route">
              <div className="calc-fact calc-fact-lead solve-route-method">{route.method}</div>
              <ol className="solve-steps">
                {route.steps.map((st, i) => (
                  <li key={i} className="solve-step">
                    {st.text}
                  </li>
                ))}
              </ol>
              {route.kind !== 'exp' && route.candidates.length > 0 && (
                <>
                  <div className="solve-table-intro">Check each candidate in the original equation:</div>
                  <ul className="calc-facts solve-candidates">
                    {route.candidates.map((c, i) => (
                      <li
                        key={i}
                        className={`calc-fact solve-candidate ${c.ok ? 'solve-yes' : 'solve-no'}`}
                        data-testid="solve-candidate"
                        data-ok={c.ok ? 'yes' : 'no'}
                      >
                        <span className="solve-candidate-mark" aria-hidden="true">{c.ok ? '✓' : '✗'}</span>{' '}
                        <strong>{`${result.variable || 'x'} = ${c.text}`}</strong>
                        {c.ok ? ' — a solution: ' : ' — extraneous: '}
                        <span className="solve-candidate-why">{c.reason}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {route.exp && (
                <div className="calc-fact solve-exact" data-testid="solve-exact-forms">
                  <Latex tex={`${result.variable || 'x'} = ${route.exp.forms.map((f) => f.tex).join(' = ')} \\approx ${route.exp.x.toFixed(4)}`} />
                </div>
              )}
              <div className="solve-conclusion">{route.summary}</div>
            </Answer>
          </CardSection>
        </div>
      )}

      {result && (
        <div className="solve-controls" onClick={(e) => e.stopPropagation()}>
          {chip('signs', 'sign row', 'The + / − row above the line, with 0 and und at the critical values')}
          {chip('tests', 'test points', 'Mark each test point on the line (t = 0)')}
          {hasDistance && chip('distance', 'distance', 'Read |x − a| < b as a distance: the centre and a bracket of radius b')}
          {compound && chip('stacked', 'stacked', 'One line per clause (A, B), then the combined set')}
          {canGraph && (
            <button
              type="button"
              className="calc-chip solve-graph"
              data-testid="solve-show-on-graph"
              title={
                bothSides
                  ? 'Graph both sides, y₁ and y₂, on the Graph board: the solutions are where the graphs meet'
                  : 'Graph y = h(x) with its sign chart on the Graph board: the solution is where the graph is above / below the x-axis'
              }
              onClick={() => setGraphError(onShowOnGraph())}
            >
              Show on graph
            </button>
          )}
          {graphError && <div className="expr-error">{graphError}</div>}
        </div>
      )}

      {result && (
        <div onClick={(e) => e.stopPropagation()}>
          <CardSection
            kind="nl-working"
            title="Show working"
            titleHint="The number-line method: h(x), its domain, the critical values, a test point in each interval, the conclusion"
            summary={result.solution.text}
            defaultOpen={false}
            answerKey={solveKey(item.id)}
            testId="solve-working"
            openActions={
              <button type="button" className="calc-chip" data-testid="solve-copy-text" onClick={copyWorking}>
                {copied ? 'copied' : 'Copy as text'}
              </button>
            }
          >
            <Answer k={solveKey(item.id)} block what="the working">
            <ol className="solve-steps">
              {steps.map((s, i) => {
                if (s.kind === 'heading')
                  return (
                    <li key={i} className="solve-step-head">
                      <Latex tex={s.tex} />
                    </li>
                  )
                if (s.kind === 'line')
                  return (
                    <li key={i} className="solve-step">
                      {s.tex ? <Latex tex={s.tex} /> : s.text}
                    </li>
                  )
                if (s.kind === 'table')
                  return (
                    <li key={i} className="solve-step">
                      <div className="solve-table-intro">A test point in each interval:</div>
                      <table className="limit-table solve-table">
                        <thead>
                          <tr>
                            <th>interval</th>
                            <th>t</th>
                            <th>{s.hName}</th>
                            <th>sign</th>
                            <th aria-label="satisfies">✓/✗</th>
                          </tr>
                        </thead>
                        <tbody>
                          {s.rows.map((r, ri) => (
                            <tr key={ri} className={r.ok ? 'solve-yes' : 'solve-no'}>
                              <td>{r.interval}</td>
                              <td>{r.t}</td>
                              <td>{r.value}</td>
                              <td>{r.sign}</td>
                              <td>{r.ok ? '✓' : '✗'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </li>
                  )
                if (s.kind === 'conclusion')
                  return (
                    <li key={i} className="solve-conclusion">
                      {s.text}
                    </li>
                  )
                return (
                  <li key={i} className="solve-note">
                    {s.text}
                  </li>
                )
              })}
            </ol>
            </Answer>
          </CardSection>
        </div>
      )}

      {selected && (
        <div className="card-body" onClick={(e) => e.stopPropagation()}>
          <label className="nl-label-row">
            <span className="nl-label-tag">Label</span>
            <input
              className="nl-label-input"
              type="text"
              maxLength={60}
              spellCheck={false}
              placeholder="e.g. solution of (1)"
              value={labelDraft ?? item.label ?? ''}
              onChange={(e) => setLabelDraft(e.target.value)}
              onBlur={() => setLabelDraft(null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (labelDraft !== null) onLabel(labelDraft)
                  setLabelDraft(null)
                  e.currentTarget.blur()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setLabelDraft(null)
                  e.currentTarget.blur()
                }
              }}
            />
          </label>
          <div className="style-row">
            <input
              type="range"
              className="style-slider"
              title="Bar thickness"
              aria-label="Bar thickness"
              min={NL_MIN_BAR_WIDTH}
              max={NL_MAX_BAR_WIDTH}
              step={0.5}
              value={style?.width ?? NL_BAR_WIDTH}
              style={fillStyle(style?.width ?? NL_BAR_WIDTH, NL_MIN_BAR_WIDTH, NL_MAX_BAR_WIDTH)}
              onPointerDown={onStyleEditStart}
              onPointerUp={onStyleEditEnd}
              onKeyDown={onStyleEditStart}
              onKeyUp={onStyleEditEnd}
              onBlur={onStyleEditEnd}
              onChange={(e) => onWidth(Number(e.target.value))}
            />
          </div>
        </div>
      )}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { CardSection } from './CardSection'
import { Latex } from './Latex'
import { parseNumeric } from './numeric'
import { EULER_N_MAX, EULER_N_MIN } from './eulerLinks'
import type { EulerRunCard, RunPatch } from './eulerLinks'
import type { EulerNumber } from '../core/euler'

// ============================================================================
// src/ui/EulerSection.tsx — "Euler's method" on a slope field's card.
//
// One block per run: the start (x₀, y₀), the step h and the count n — each
// typeable exactly, `1/2` and `pi` included — the target x = x₀ + n·h, the
// table a student would fill in, the approximation, the true value and the
// AP over/under verdict with its reason.
//
// Nothing here computes: the rows, the verdict and every number's printed
// form arrive already worked out (src/ui/eulerLinks.ts), so the table on the
// card and the path on the board come from the same pass.
// ============================================================================

interface Props {
  runs: EulerRunCard[]
  onAdd(): void
  onPatch(runId: string, patch: RunPatch): void
  onRemove(runId: string): void
}

type Which = 'x0' | 'y0' | 'h' | 'n'

/** What goes in the input when a value is opened for typing. */
function editable(n: EulerNumber, raw: number): string {
  if (!n.exact) return String(raw)
  return n.text.replace(/−/g, '-').replace(/π/g, 'pi').replace(/√(\d+)/g, 'sqrt($1)')
}

/** A number cell: the exact reading, with the decimal in the tooltip when they differ. */
function Num({ v, muted = false }: { v: EulerNumber; muted?: boolean }): JSX.Element {
  return (
    <td
      className={`euler-num${muted ? ' euler-num-muted' : ''}`}
      title={v.exact && v.text !== v.decimal ? `≈ ${v.decimal}` : undefined}
    >
      {v.text}
    </td>
  )
}

function Swatch({ color, dash }: { color: string; dash: readonly number[] }): JSX.Element {
  return (
    <svg className="euler-swatch" width="22" height="10" viewBox="0 0 22 10" aria-hidden="true">
      <line
        x1="2"
        y1="5"
        x2="20"
        y2="5"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={dash.length > 0 ? dash.map((d) => d * 0.6).join(' ') : undefined}
      />
      <circle cx="3" cy="5" r="2.5" fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  )
}

function RunBlock({
  run,
  onPatch,
  onRemove,
}: {
  run: EulerRunCard
  onPatch(patch: RunPatch): void
  onRemove(): void
}): JSX.Element {
  const [edit, setEdit] = useState<{ which: Which; text: string; bad: boolean } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const open = edit?.which ?? null
  useEffect(() => {
    if (open) inputRef.current?.select()
  }, [open])

  const commit = (): void => {
    if (!edit) return
    const v = parseNumeric(edit.text)
    const ok =
      v !== null &&
      (edit.which !== 'h' || v !== 0) &&
      (edit.which !== 'n' || (Number.isInteger(v) && v >= EULER_N_MIN && v <= EULER_N_MAX))
    if (!ok || v === null) {
      setEdit({ ...edit, bad: true })
      return
    }
    onPatch({ [edit.which]: v })
    setEdit(null)
  }

  const hint: Record<Which, string> = {
    x0: 'The start x₀ — type 1, 1/2, pi …',
    y0: 'The start y₀ — type 1, 1/2, pi …',
    h: 'The step size h — negative steps to the left',
    n: `The number of steps, ${EULER_N_MIN} to ${EULER_N_MAX}`,
  }

  const field = (which: Which, label: string, shown: EulerNumber | string, raw: number): JSX.Element => {
    if (edit?.which === which) {
      return (
        <span className="calc-field">
          <span className="calc-field-label">{label}</span>
          <input
            ref={inputRef}
            className={`calc-input euler-input${edit.bad ? ' param-edit-bad' : ''}`}
            type="text"
            inputMode={which === 'n' ? 'numeric' : 'decimal'}
            spellCheck={false}
            aria-label={hint[which]}
            aria-invalid={edit.bad || undefined}
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
    const text = typeof shown === 'string' ? shown : shown.text
    return (
      <button
        type="button"
        className="calc-field calc-field-btn"
        title={hint[which]}
        data-euler-field={which}
        onClick={() =>
          setEdit({
            which,
            text: typeof shown === 'string' ? shown : editable(shown, raw),
            bad: false,
          })
        }
      >
        <span className="calc-field-label">{label}</span>
        <span className="calc-field-value">{text}</span>
      </button>
    )
  }

  const v = run.verdict
  return (
    <div className="calc-row euler-run" data-euler={run.id}>
      <div className="calc-line">
        <Swatch color={run.color} dash={run.dash} />
        <span className="calc-read euler-caption">{run.caption}</span>
        <button
          type="button"
          className="calc-drop"
          title="Remove this run of Euler’s method"
          aria-label={`Remove ${run.caption}`}
          onClick={onRemove}
        >
          ×
        </button>
      </div>

      <div className="calc-controls">
        {field('x0', 'x₀', run.x0Text, run.x0)}
        {field('y0', 'y₀', run.y0Text, run.y0)}
      </div>
      <div className="calc-controls">
        {field('h', 'h', run.hText, run.h)}
        <button
          type="button"
          className="calc-chip euler-step"
          aria-label="One step fewer"
          title="One step fewer"
          disabled={run.n <= EULER_N_MIN}
          onClick={() => onPatch({ n: run.n - 1 })}
        >
          −
        </button>
        {field('n', 'n', String(run.n), run.n)}
        <button
          type="button"
          className="calc-chip euler-step"
          aria-label="One step more"
          title="One step more"
          disabled={run.n >= EULER_N_MAX}
          onClick={() => onPatch({ n: run.n + 1 })}
        >
          +
        </button>
        <span className="calc-note euler-target" title="x₀ + n·h">
          → x = {run.target.text}
        </span>
      </div>

      {run.rows.length > 0 && (
        <div className="euler-table-wrap">
          <table className="euler-table">
            <thead>
              <tr>
                <th scope="col">n</th>
                <th scope="col">xₙ</th>
                <th scope="col">yₙ</th>
                <th scope="col" title="dy/dx = f(xₙ, yₙ)">
                  dy/dx
                </th>
                <th scope="col" title="Δy = h·dy/dx">
                  Δy
                </th>
              </tr>
            </thead>
            <tbody>
              {run.rows.map((r) => (
                <tr key={r.k} className={r.last ? 'euler-last' : undefined}>
                  <td className="euler-k">{r.k}</td>
                  <Num v={r.x} />
                  <Num v={r.y} />
                  <Num v={r.slope} muted={r.last} />
                  <Num v={r.dy} muted={r.last} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {run.stopped && <div className="calc-why">{run.stopped}</div>}

      {run.approx && (
        <ul className="calc-facts euler-facts">
          <li className="calc-fact calc-fact-lead euler-approx">
            {run.approx.lhs} ≈ {run.approx.value.text}
            {run.approx.value.exact && run.approx.value.text !== run.approx.value.decimal
              ? ` ≈ ${run.approx.value.decimal}`
              : ''}
          </li>
          {run.trueY && (
            <li className="calc-fact calc-fact-lead">
              {`actual ${run.approx.lhs} = ${run.trueY.text}`}
              {run.error ? ` · error ${run.error.text}` : ''}
            </li>
          )}
          {v && (
            <li className="calc-fact">
              <span className={`euler-verdict euler-verdict-${v.kind}`}>{v.label}</span>
            </li>
          )}
          {v?.d2tex && (
            <li className="calc-fact euler-d2">
              <Latex tex={`\\frac{d^2y}{dx^2} = ${v.d2tex}`} />
            </li>
          )}
          {v && <li className="calc-fact euler-reason">{v.reason}</li>}
          {v?.caution && <li className="calc-fact euler-caution">{v.caution}</li>}
        </ul>
      )}

      <div className="calc-controls">
        <button
          type="button"
          className={`calc-chip${run.showTrue ? ' calc-chip-on' : ''}`}
          aria-pressed={run.showTrue}
          title="Draw the true solution through (x₀, y₀), dotted"
          onClick={() => onPatch({ showTrue: !run.showTrue })}
        >
          Show the actual solution
        </button>
        <button
          type="button"
          className={`calc-chip${run.labels ? ' calc-chip-on' : ''}`}
          aria-pressed={run.labels}
          title="Label the points P₀, P₁, … on the board"
          onClick={() => onPatch({ labels: !run.labels })}
        >
          Labels P₀, P₁ …
        </button>
      </div>
    </div>
  )
}

export function EulerSection({ runs, onAdd, onPatch, onRemove }: Props): JSX.Element {
  return (
    <CardSection
      kind="euler"
      title="Euler’s method"
      summary={
        runs.length === 0
          ? null
          : runs.map((r) => r.caption.replace(/^Euler’s method,\s*/, '')).join(' · ')
      }
      className="field-section euler-section"
    >
      {runs.length > 0 && (
        <div className="calc-list">
          {runs.map((run) => (
            <RunBlock
              key={run.id}
              run={run}
              onPatch={(patch) => onPatch(run.id, patch)}
              onRemove={() => onRemove(run.id)}
            />
          ))}
        </div>
      )}
      <div className="calc-controls">
        <button
          type="button"
          className="calc-chip euler-add"
          title={
            runs.length === 0
              ? 'Step along the field from a start point: h = 0.5, n = 4'
              : 'Another run from the same start, with the step halved — compare h and h/2'
          }
          onClick={onAdd}
        >
          + Euler’s method
        </button>
      </div>
    </CardSection>
  )
}

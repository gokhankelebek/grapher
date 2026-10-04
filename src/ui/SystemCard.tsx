// ============================================================================
// src/ui/SystemCard.tsx — the inequalities on the board, as a system.
//
//   SYSTEM OF INEQUALITIES                               3 inequalities
//   [✓] Show solution region (intersection)
//   [✓] Test point   (1, 2)
//         y < x² − 4        2 < 1² − 4 → 2 < −3 ✗
//         y ≥ 2x + 1        2 ≥ 2·1 + 1 → 2 ≥ 3 ✗
//   ▾ LINEAR PROGRAMMING
//         Bounded feasible region with 4 corners.
//         P = [3x + 2y]  (Max | Min)
//         corner | P                  table, the optimum highlighted
//         Maximum P = 12 at (4, 0).
//         [ ] Iso-profit line
//
// The system is every VISIBLE inequality (hide a card to take it out). Every
// string arrives from src/ui/systemLinks.ts; this file only lays them out and
// reports what the teacher changes.
// ============================================================================

import { useEffect, useState } from 'react'
import type { BoardIneqSystem } from '../core/persist'
import type { SystemCardData } from './systemLinks'
import { Latex } from './Latex'
import { Answer } from './RevealAnswer'
import { SYSTEM_KEY } from './reveal'
import { CardSection } from './CardSection'

interface Props {
  data: SystemCardData
  system: BoardIneqSystem | null
  /** Inequalities on the board that are hidden (not in the system). */
  hidden: number
  onSolution(on: boolean): void
  onTest(on: boolean): void
  /** Set the objective; returns an error to show, or null. Empty clears it. */
  onObjective(src: string, goal: 'max' | 'min'): string | null
  onIso(on: boolean): void
}

export function SystemCard({ data, system, hidden, onSolution, onTest, onObjective, onIso }: Props) {
  const n = data.members.length
  const lp = data.lp
  const obj = lp?.objective ?? null
  const [draft, setDraft] = useState<string>(system?.objective?.src ?? 'P = 3x + 2y')
  const [err, setErr] = useState<string | null>(null)
  const goal = system?.objective?.goal ?? 'max'
  useEffect(() => {
    if (system?.objective?.src !== undefined) setDraft(system.objective.src)
  }, [system?.objective?.src])

  const commit = (g: 'max' | 'min' = goal): void => {
    const e = onObjective(draft, g)
    setErr(e)
  }

  return (
    <div className="card field-card ineq-system-card" data-testid="ineq-system-card" onClick={(e) => e.stopPropagation()}>
      <div className="card-head">
        <span className="ineq-sys-glyph" aria-hidden="true">
          ▦
        </span>
        <span className="model-name">{n >= 2 ? 'System of inequalities' : 'Inequality'}</span>
        <span className="card-flag ineq-sys-count">
          {n} shown{hidden > 0 ? ` · ${hidden} hidden` : ''}
        </span>
      </div>
      <div className="card-body card-body-sections">
        <div className="ineq-sys-toggles">
          <label
            className="te-check"
            title={n >= 2 ? 'Shade only the points that satisfy every visible inequality' : 'Needs two or more visible inequalities'}
          >
            <input
              type="checkbox"
              data-testid="ineq-solution"
              checked={system?.solution === true}
              disabled={n < 2 && system?.solution !== true}
              onChange={() => onSolution(system?.solution !== true)}
            />
            <span>Show solution region (intersection)</span>
          </label>
          <label className="te-check" title="A point to drag: is it a solution of each inequality?">
            <input type="checkbox" data-testid="ineq-test-toggle" checked={system?.test !== undefined} onChange={() => onTest(system?.test === undefined)} />
            <span>Test point{data.test ? ` ${data.test.label}` : ''}</span>
          </label>
        </div>
        {data.test && (
          <div className="ineq-test-rows" data-testid="ineq-test-rows">
            {data.test.rows.map((r) => {
              const m = data.members.find((mm) => mm.id === r.id)
              return (
                <div key={r.id} className={`ineq-test-row ${r.ok ? 'ineq-ok' : 'ineq-no'}`}>
                  <span className="ineq-dot" style={{ background: r.color }} />
                  {m && <Latex tex={m.latex} className="ineq-row-latex" />}
                  <span className="ineq-row-text">{r.text}</span>
                </div>
              )
            })}
            {n >= 2 && (
              <div className={`ineq-test-verdict ${data.test.all ? 'ineq-ok' : 'ineq-no'}`}>
                {data.test.label} {data.test.all ? 'is a solution of the system ✓' : 'is not a solution of the system ✗'}
              </div>
            )}
            <div className="field-hint">Drag the point on the board.</div>
          </div>
        )}
        {lp && n >= 2 && (
          <CardSection kind="ineq-lp" title="Linear programming" summary={lp.status} testId="ineq-lp">
            <div className="ineq-lp-status" data-testid="ineq-lp-status">
              {lp.status}
            </div>
            {lp.region.vertices.length > 0 && (
              <div className="ineq-corners" data-testid="ineq-corners">
                Corners:{' '}
                <Answer k={SYSTEM_KEY} what="the corners">
                  {lp.region.vertices.map((v) => v.label).join('  ')}
                </Answer>
                {lp.region.vertices.some((v) => v.onStrict) && (
                  <span className="field-hint"> (hollow: on a dashed boundary, not included)</span>
                )}
                {!(system?.solution || system?.objective) && (
                  <span className="field-hint"> — show the solution region to mark them</span>
                )}
              </div>
            )}
            <div className="fe-a-row ineq-obj-row">
              <input
                className={`calc-input ineq-obj-input${err || obj?.error ? ' fe-input-bad' : ''}`}
                data-testid="ineq-objective"
                value={draft}
                spellCheck={false}
                aria-label="Objective function"
                onChange={(e) => {
                  setDraft(e.target.value)
                  setErr(null)
                }}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commit()
                  }
                }}
                onBlur={() => {
                  if (system?.objective && draft !== system.objective.src) commit()
                }}
              />
              <div className="seg" role="group" aria-label="Maximize or minimize">
                {(['max', 'min'] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    className={`seg-btn${system?.objective && goal === g ? ' seg-on' : ''}`}
                    data-testid={`ineq-goal-${g}`}
                    onClick={() => commit(g)}
                  >
                    {g === 'max' ? 'Max' : 'Min'}
                  </button>
                ))}
              </div>
              {system?.objective && (
                <button
                  type="button"
                  className="calc-drop"
                  title="Remove the objective"
                  aria-label="Remove the objective"
                  onClick={() => {
                    setErr(onObjective('', goal))
                  }}
                >
                  ×
                </button>
              )}
            </div>
            {(err || obj?.error) && <div className="expr-error">{err ?? obj?.error}</div>}
            {obj?.result && (
              <>
                <Answer k={SYSTEM_KEY} block what="the optimum">
                {obj.result.rows.length > 0 && obj.obj && (
                  <div className="seq-table-wrap">
                    <table className="seq-table ineq-lp-table" data-testid="ineq-lp-table">
                      <thead>
                        <tr>
                          <th>Corner</th>
                          <th>
                            {obj.obj.name} = {obj.obj.text}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {obj.result.rows.map((r, i) => (
                          <tr key={i} className={r.best ? 'ineq-best' : ''}>
                            <td>{r.vertex.label}</td>
                            <td>{r.work}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className={`ineq-lp-answer ${obj.result.status === 'optimal' ? 'ineq-ok' : 'ineq-no'}`} data-testid="ineq-lp-answer">
                  {obj.result.sentence}
                </div>
                </Answer>
                {obj.result.status === 'optimal' && (
                  <label className="te-check" title="The line P = optimum through the best corner">
                    <input type="checkbox" data-testid="ineq-iso" checked={system?.iso === true} onChange={() => onIso(system?.iso !== true)} />
                    <span>Iso-profit line through the optimum</span>
                  </label>
                )}
              </>
            )}
            {!system?.objective && (
              <div className="field-hint">Type an objective and choose Max or Min.</div>
            )}
          </CardSection>
        )}
        {!lp && data.notLinear && n >= 2 && <div className="field-hint">{data.notLinear}</div>}
      </div>
    </div>
  )
}

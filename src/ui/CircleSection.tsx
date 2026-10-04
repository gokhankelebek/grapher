// ============================================================================
// src/ui/CircleSection.tsx — "Circle theorems" on a circle's card
// (NC Math 3 G-C.2, G-C.5, G-CO.14).
//
//   ▾ CIRCLE THEOREMS                             ∠PRQ = 60° · s = 4π
//     Points on the circle   P [30°]  (3√3, 3) · π/6   ×
//                            Q [150°] (−3√3, 3) · 5π/6 ×   + point
//     Show on board  [Inscribed & central angle] [Tangent] [Arc & sector] [Crossing chords] [Tangents from T]
//     ∠POQ = 120° (central) · ∠PRQ = 60° (inscribed) · ∠PRQ = ½·∠POQ
//     Tangent at P: y = −√3x + 12 · OP ⟂ the tangent: …
//     Sector POQ: θ = 120° = 2π/3 · s = rθ = 6 · 2π/3 = 4π · A = ½r²θ = 12π …
//
// The points are typed: an angle (a plain number is degrees; π or "rad" is
// radians) or coordinates, which are moved onto the circle when they are off
// it. Only what was typed is stored (CircleView); everything printed is
// recomputed by src/ui/circleLinks.ts. Every value is an answer under
// circle:<curveId>:<part> for reveal mode.
// ============================================================================

import { useEffect, useState } from 'react'
import type { CircleFlag, CircleView } from '../core/persist'
import { MAX_CIRCLE_POINTS } from '../core/circleGeometry'
import { withApprox } from '../core/geometry'
import { CardSection } from './CardSection'
import { Latex } from './Latex'
import { Answer, AnswerTex } from './RevealAnswer'
import { circleKey } from './reveal'
import type { CirclePart } from './reveal'
import type { CirclePanel } from './circleLinks'
import { nextCirclePoint, setCirclePoint, toggleCircleFlag } from './circleLinks'

export interface CircleActions {
  /** Replace one circle's settings (never an undo step; saved with the document). */
  set(curveId: string, next: CircleView): void
}

/** "= (2, 3)" or "≈ (3.7, 1.53)": a point's coordinates after its name. */
const eqPt = (t: string): string => (t.startsWith('≈') ? t : `= ${t}`)

function Field({
  value,
  title,
  placeholder,
  onCommit,
  testId,
  width,
}: {
  value: string
  title: string
  placeholder?: string
  onCommit(text: string): void
  testId?: string
  width?: number
}) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <input
      className="calc-input ci-input"
      style={width ? { width } : undefined}
      type="text"
      spellCheck={false}
      autoComplete="off"
      aria-label={title}
      title={title}
      placeholder={placeholder}
      data-testid={testId}
      value={text}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          if (text.trim() !== '' && text !== value) onCommit(text.trim())
        } else if (e.key === 'Escape') {
          e.preventDefault()
          setText(value)
        }
      }}
      onBlur={() => {
        if (text.trim() !== '' && text !== value) onCommit(text.trim())
        else setText(value)
      }}
    />
  )
}

const isErr = (x: unknown): x is { error: string } => typeof x === 'object' && x !== null && 'error' in x

export function CircleSection({ panel, actions }: { panel: CirclePanel; actions: CircleActions }) {
  const p = panel
  const k = (part: CirclePart): string => circleKey(p.curveId, part)
  const set = (next: CircleView): void => actions.set(p.curveId, next)
  const flip = (f: CircleFlag): void => set(toggleCircleFlag(p.view, f, p.circle))
  const summaryParts: string[] = []
  if (p.angles && !isErr(p.angles)) summaryParts.push(`inscribed ${p.angles.inscribed.text}`)
  if (p.sector && !isErr(p.sector)) summaryParts.push(`s ${p.sector.arc.exact ? `= ${p.sector.arc.text}` : p.sector.arc.text}`)
  if (p.tangent && !isErr(p.tangent)) summaryParts.push('tangent')
  const summary = summaryParts.length > 0 ? summaryParts.join(' · ') : `centre ${p.circle.centreText.text}, r = ${p.circle.radius.text}`
  const ptName = (i: number): string => p.rows[i]?.name ?? 'P'

  return (
    <CardSection
      kind="circle-geo"
      title="Circle theorems"
      titleHint="Points on the circle: inscribed and central angles, the tangent, arc length and sector area, crossing chords, tangents from a point"
      summary={summary}
      testId="circle-geo"
    >
      <div className="calc-fact calc-fact-lead ci-circle">
        {p.circle.equation} · centre O{p.circle.centreText.text} · r = {withApprox(p.circle.radius)}
      </div>

      <div className="secant-block">
        <div className="secant-block-title">Points on the circle</div>
        <ul className="calc-facts ci-points">
          {p.rows.map((row, i) => (
            <li key={row.name} className="calc-fact ci-point" data-testid={`circle-point-${row.name}`}>
              <span className="measure-name">{row.name}</span>
              <Field
                value={row.text}
                title={`${row.name}: an angle (30, 30°, pi/6) or a point (3, 4)`}
                placeholder="30° or (3, 4)"
                width={84}
                testId={`circle-pt-${i}`}
                onCommit={(t) => set(setCirclePoint(p.view, i, t))}
              />
              {row.ok ? (
                <span className="ci-coords">
                  {row.p.coords.text} · {row.p.degText}
                  {row.p.radText && !row.p.radText.startsWith('≈') ? ` = ${row.p.radText}` : ''}
                  {row.p.moved && <span className="calc-why"> — moved onto the circle</span>}
                </span>
              ) : (
                <span className="calc-why">{row.error}</span>
              )}
              <button
                type="button"
                className="calc-chip ci-remove"
                title={`Remove ${row.name}`}
                aria-label={`Remove ${row.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  set(setCirclePoint(p.view, i, null))
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        {p.rows.length < MAX_CIRCLE_POINTS && (
          <button
            type="button"
            className="calc-chip"
            data-testid="circle-add-point"
            title="Add a point on the circle"
            onClick={(e) => {
              e.stopPropagation()
              set(setCirclePoint(p.view, p.rows.length, nextCirclePoint(p.view)))
            }}
          >
            + point
          </button>
        )}
        <div className="field-hint">A plain number is degrees; pi/6 or 1.2 rad is radians; a point (3, 4) off the circle is moved onto it.</div>
      </div>

      <div className="measure-toggles" role="group" aria-label="Show on board">
        <span className="measure-toggles-label">Show on board</span>
        {p.toggles.map((t) => (
          <button
            key={t.flag}
            type="button"
            className={`calc-chip${t.on ? ' calc-chip-on' : ''}`}
            aria-pressed={t.on}
            title={t.hint}
            data-testid={`circle-${t.flag}`}
            onClick={(e) => {
              e.stopPropagation()
              flip(t.flag)
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {p.angles && (
        <div className="secant-block" data-testid="circle-angles">
          <div className="secant-block-title">Inscribed and central angles</div>
          {isErr(p.angles) ? (
            <div className="calc-why">{p.angles.error}</div>
          ) : (
            <Answer k={k('angles')} block what="the angles">
              <div className="calc-fact calc-fact-lead">
                ∠{ptName(0)}O{ptName(1)} {eqPt(p.angles.central.text)} (central{p.angles.central.reflex ? ', reflex' : ''})
              </div>
              <div className="calc-fact calc-fact-lead">
                ∠{ptName(0)}{ptName(2)}{ptName(1)} {eqPt(p.angles.inscribed.text)} (inscribed)
              </div>
              <div className="calc-fact">{p.angles.intercepts}</div>
              <div className="calc-fact measure-sentence">{p.angles.relation}</div>
              {p.angles.diameter && (
                <div className="calc-fact">An angle inscribed in a semicircle is a right angle.</div>
              )}
            </Answer>
          )}
        </div>
      )}

      {p.tangent && (
        <div className="secant-block" data-testid="circle-tangent">
          <div className="secant-block-title">
            Tangent at{' '}
            {p.rows.length > 1 ? (
              <select
                className="calc-select"
                aria-label="Tangent at"
                value={p.at}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => set({ ...p.view, at: Number(e.target.value) || undefined })}
              >
                {p.rows.map((r, i) => (
                  <option key={r.name} value={i}>
                    {r.name}
                  </option>
                ))}
              </select>
            ) : (
              ptName(p.at)
            )}
          </div>
          {isErr(p.tangent) ? (
            <div className="calc-why">{p.tangent.error}</div>
          ) : (
            <>
              <div className="calc-fact">
                <AnswerTex k={k('tangent')} tex={p.tangent.line.slopeIntercept.tex} what="the tangent's equation" />
              </div>
              {!p.tangent.line.slope.vertical && (
                <div className="calc-fact">
                  <AnswerTex k={k('tangent')} tex={p.tangent.line.pointSlope.tex} what="the tangent's equation" />
                </div>
              )}
              <Answer k={k('tangent')} block what="why it is perpendicular">
                <div className="calc-fact measure-sentence">
                  The radius is perpendicular to the tangent where they meet. {p.tangent.reason}.
                </div>
              </Answer>
            </>
          )}
        </div>
      )}

      {p.sector && (
        <div className="secant-block" data-testid="circle-sector">
          <div className="secant-block-title">
            Arc and sector {ptName(0)}O{ptName(1)} (counterclockwise from {ptName(0)})
          </div>
          {isErr(p.sector) ? (
            <div className="calc-why">{p.sector.error}</div>
          ) : (
            <>
              <div className="calc-fact calc-fact-lead">
                θ {eqPt(p.sector.degText)} {p.sector.theta.exact ? `= ${p.sector.theta.text}` : p.sector.theta.text}
                {p.sector.theta.exact ? '' : ' rad'}
              </div>
              <Answer k={k('sector')} block what="the arc length and the sector area">
                <div className="calc-fact calc-fact-lead" data-testid="circle-arc">
                  {p.sector.arcRadian}
                  {p.sector.arc.exact ? ` ≈ ${(p.sector.arc.value).toFixed(2)}` : ''}
                </div>
                <div className="calc-fact">{p.sector.arcDegree}</div>
                <div className="calc-fact calc-fact-lead" data-testid="circle-area">
                  {p.sector.areaRadian}
                  {p.sector.area.exact ? ` ≈ ${(p.sector.area.value).toFixed(2)}` : ''}
                </div>
                <div className="calc-fact">{p.sector.areaDegree}</div>
                <div className="calc-fact measure-sentence">{p.sector.radianDef}</div>
              </Answer>
            </>
          )}
        </div>
      )}

      {p.chords && (
        <div className="secant-block" data-testid="circle-chords">
          <div className="secant-block-title">Crossing chords</div>
          {isErr(p.chords) ? (
            <div className="calc-why">{p.chords.error}</div>
          ) : (
            <Answer k={k('chords')} block what="the products">
              <div className="calc-fact">E {eqPt(p.chords.eText.text)}</div>
              <div className="calc-fact calc-fact-lead">{p.chords.left}</div>
              <div className="calc-fact calc-fact-lead">{p.chords.right}</div>
              <div className="calc-fact">{p.chords.power}</div>
            </Answer>
          )}
        </div>
      )}

      {p.external !== null && p.toggles.some((t) => t.flag === 'external' && t.on) && (
        <div className="secant-block" data-testid="circle-external">
          <div className="secant-block-title">
            Tangents from T ={' '}
            <Field
              value={p.view.ext ?? ''}
              title="The outside point T, as (x, y)"
              placeholder="(8, 0)"
              width={84}
              testId="circle-ext"
              onCommit={(t) => set({ ...p.view, ext: t })}
            />
          </div>
          {isErr(p.external) ? (
            <div className="calc-why">{p.external.error}</div>
          ) : (
            <Answer k={k('external')} block what="the tangent lengths">
              <div className="calc-fact calc-fact-lead">{p.external.lengthText}</div>
              <div className="calc-fact">
                A {eqPt(p.external.aText.text)}, B {eqPt(p.external.bText.text)}
              </div>
              <div className="calc-fact">Two tangent segments from the same outside point are equal.</div>
              {p.external.secant && (
                <div className="calc-fact calc-fact-lead">
                  {p.external.secant.text} (the secant through {p.external.secant.through} meets the circle again at{' '}
                  {p.external.secant.through}′ {eqPt(p.external.secant.p2Text.text)})
                </div>
              )}
            </Answer>
          )}
        </div>
      )}
    </CardSection>
  )
}

// ============================================================================
// src/ui/ShapeMeasureSection.tsx — Measurements on a shape's card.
//
//   ▾ MEASUREMENTS                                     A = 11 · parallelogram
//     Show on board  [Side lengths] [Slopes] [Angles] [Right angles] …  All · None
//     AB = √17 ≈ 4.12    m = 1/4    midpoint (2, 1/2)
//     …
//     ∠A = 77.5°  ∠B = 102.5°  …          (4 − 2)·180° = 360°
//     Perimeter = 2√10 + 2√17 ≈ 14.57     Area = 11   (½|0 + 11 + 11 + 0|)
//     AB ∥ DC (slope 1/4) and AD ∥ BC (slope 3), so ABCD is a parallelogram.
//   ▾ RIGHT TRIANGLE        (a right triangle only)
//     right angle at B · 4² + 3² = 5² · sin A = BC/CA = 3/5 … · 30-60-90
//   Line through a point:  [side ▾] [point ▾]  ∥  ⊥
//
// Everything printed arrives computed (src/ui/shapeMeasure.ts →
// MeasureCardData); every answer is wrapped for reveal mode under the shape's
// own keys (src/ui/reveal.ts shapeKey). The toggles are the only edits: they
// say what is DRAWN, and they are stored with the shape.
// ============================================================================

import { useState } from 'react'
import type { MeasureFlag } from '../core/types'
import type { ShapeMeasureSettings } from '../core/persist'
import { needsApprox, withApprox } from '../core/geometry'
import type { Measure } from '../core/geometry'
import { CardSection } from './CardSection'
import { Latex } from './Latex'
import { Answer, AnswerTex } from './RevealAnswer'
import { shapeKey } from './reveal'
import type { ShapePart } from './reveal'
import type { MeasureCardData } from './shapeMeasure'
import { setAllMeasure, setMeasureTo, toggleMeasure } from './shapeMeasure'

interface Props {
  shapeId: string
  data: MeasureCardData
  settings: ShapeMeasureSettings | undefined
  onMeasure(next: ShapeMeasureSettings | undefined, label: string): void
  /** Add a shape from a typed line; the parser's complaint or null. */
  onAddShape(src: string): string | null
}

/** "√13 ≈ 3.61" with the decimal quieter. */
function M({ m }: { m: Measure }) {
  if (!m.exact) return <span className="measure-val">≈ {m.text}</span>
  return (
    <span className="measure-val">
      {m.text}
      {needsApprox(m) && <span className="measure-approx"> ≈ {m.approx}</span>}
    </span>
  )
}

export function ShapeMeasureSection({ shapeId, data, settings, onMeasure, onAddShape }: Props) {
  const k = (part: ShapePart): string => shapeKey(shapeId, part)
  const r = data.reports
  const anyOn = data.toggles.some((t) => t.on)
  const allOn = data.toggles.every((t) => t.on)

  const flip = (flag: MeasureFlag, label: string, on: boolean): void =>
    onMeasure(toggleMeasure(settings, flag), `${on ? 'hide' : 'show'} ${label.toLowerCase()}`)

  const toggles = data.toggles.length > 0 && (data.kind !== 'point' || data.to) && (
    <div className="measure-toggles" role="group" aria-label="Show on board">
      <span className="measure-toggles-label">Show on board</span>
      {data.toggles.map((t) => (
        <button
          key={t.flag}
          type="button"
          className={`calc-chip${t.on ? ' calc-chip-on' : ''}`}
          aria-pressed={t.on}
          title={t.hint}
          data-testid={`measure-${t.flag}`}
          onClick={(e) => {
            e.stopPropagation()
            flip(t.flag, t.label, t.on)
          }}
        >
          {t.label}
        </button>
      ))}
      {data.toggles.length > 2 && (
        <button
          type="button"
          className="calc-chip measure-all"
          title={allOn ? 'Draw none of these on the board' : 'Draw every measurement on the board'}
          onClick={(e) => {
            e.stopPropagation()
            onMeasure(setAllMeasure(data.kind, settings, !allOn), allOn ? 'hide measurements' : 'show measurements')
          }}
        >
          {allOn ? 'None' : anyOn ? 'All' : 'All'}
        </button>
      )}
    </div>
  )

  return (
    <>
      <CardSection
        kind="shape-measure"
        title="Measurements"
        titleHint="Lengths, slopes, angles, area and what the figure is — exact where they can be"
        summary={data.summary || null}
        answerKey={k(data.summaryPart)}
        testId="shape-measure"
      >
        {data.kind === 'point' && <PairBlock data={data} settings={settings} onMeasure={onMeasure} onAddShape={onAddShape} k={k} />}
        {toggles}
        {data.unnamed && (
          <div className="field-hint">
            Vertices are called {data.kind === 'segment' ? 'A and B' : 'A, B, C…'} in the order typed. Name them (
            {data.kind === 'segment' ? 'AB = …' : 'ABC = …'}) to label the board.
          </div>
        )}
        {data.kind === 'polygon' && r.poly && <PolygonBlock data={data} k={k} />}
        {data.kind === 'segment' && r.seg && <SegmentBlock data={data} k={k} />}
        {data.kind === 'line' && <LineBlock data={data} k={k} />}
        {data.others.length > 0 && (
          <div className="secant-block">
            <div className="secant-block-title">With the rest of the board</div>
            <Answer k={k('class')} block what="the parallel and perpendicular pairs">
              <ul className="calc-facts">
                {data.others.map((o, i) => (
                  <li key={i} className="calc-fact">
                    {o.text}
                  </li>
                ))}
              </ul>
            </Answer>
          </div>
        )}
        {data.sideNames.length > 0 && data.throughNames.length > 0 && (
          <LineTool sides={data.sideNames} points={data.throughNames} onAddShape={onAddShape} />
        )}
      </CardSection>
      {data.kind === 'polygon' && r.poly?.right && <RightBlock data={data} k={k} />}
    </>
  )
}

// ---------------------------------------------------------------------------

function PolygonBlock({ data, k }: { data: MeasureCardData; k: (p: ShapePart) => string }) {
  const r = data.reports.poly!
  return (
    <>
      <div className="secant-block">
        <div className="secant-block-title">Sides</div>
        <ul className="calc-facts measure-sides">
          {r.sides.map((s, i) => (
            <li key={i} className="calc-fact calc-fact-lead measure-side">
              <span className="measure-name">{s.name}</span>
              <span>
                {'= '}
                <Answer k={k('lengths')} what="the side lengths">
                  <M m={s.length} />
                </Answer>
              </span>
              <span className="measure-cell">
                {'m = '}
                <Answer k={k('slopes')} what="the slopes">
                  {s.slope.text}
                </Answer>
              </span>
              <span className="measure-cell">
                {'mid '}
                <Answer k={k('midpoints')} what="the midpoints">
                  {s.midpoint.text}
                </Answer>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="secant-block">
        <div className="secant-block-title">Angles</div>
        <Answer k={k('angles')} block what="the angles">
          <div className="calc-fact calc-fact-lead measure-angles">
            {r.angles.map((a, i) => (
              <span key={i}>
                ∠{r.names[i]} = {a.text}
                {a.right ? ' (right)' : a.reflex ? ' (reflex)' : ''}
              </span>
            ))}
          </div>
          <div className="calc-fact">Sum {r.angleSum}</div>
        </Answer>
      </div>
      <div className="secant-block">
        <div className="secant-block-title">Perimeter and area</div>
        <Answer k={k('area')} block what="the perimeter and area">
          <div className="calc-fact calc-fact-lead">Perimeter = {withApprox(r.perimeter)}</div>
          <div className="calc-fact calc-fact-lead">Area = {withApprox(r.area.area)}</div>
          <div className="calc-fact" title="The shoelace formula: half the absolute value of Σ (xᵢ·yᵢ₊₁ − xᵢ₊₁·yᵢ)">
            Shoelace: {r.area.working}
          </div>
        </Answer>
      </div>
      <div className="secant-block">
        <div className="secant-block-title">Classification</div>
        <Answer k={k('class')} block what="the classification">
          <div className="calc-fact measure-sentence">{r.classification.sentence}</div>
          {r.pythagTest && <div className="calc-fact">{r.pythagTest}</div>}
          {r.pairs.length > 0 && (
            <ul className="calc-facts">
              {r.pairs.map((p, i) => (
                <li key={i} className="calc-fact">
                  {p.text}
                </li>
              ))}
            </ul>
          )}
        </Answer>
      </div>
    </>
  )
}

function RightBlock({ data, k }: { data: MeasureCardData; k: (p: ShapePart) => string }) {
  const r = data.reports.poly!
  const rt = r.right!
  return (
    <CardSection
      kind="shape-right"
      title="Right triangle"
      titleHint="The right angle, the Pythagorean theorem and the trigonometric ratios"
      summary={`right angle at ${r.names[rt.right]}`}
      testId="shape-right"
    >
      <div className="calc-fact calc-fact-lead">Right angle at {r.names[rt.right]}</div>
      <Answer k={k('trig')} block what="the Pythagorean check and the trigonometric ratios">
        <div className="secant-block">
          <div className="secant-block-title">Pythagorean theorem</div>
          <div className="calc-fact calc-fact-lead">{rt.pythag.names}</div>
          <div className="calc-fact calc-fact-lead">{rt.pythag.values}</div>
          <div className="calc-fact calc-fact-lead">{rt.pythag.sums} ✓</div>
        </div>
        {rt.trig.map((t) => (
          <div className="secant-block" key={t.vertex}>
            <div className="secant-block-title">
              ∠{t.name} = {t.angle.text}
            </div>
            {[t.sin, t.cos, t.tan].map((x) => (
              <div className="measure-trig" key={x.name} title={`${x.name} = ${x.words}`}>
                <Latex tex={x.tex} />
              </div>
            ))}
          </div>
        ))}
        {rt.special && (
          <div className="secant-block">
            <div className="secant-block-title">Special right triangle: {rt.special.kind}</div>
            <div className="calc-fact calc-fact-lead">{rt.special.text}</div>
            <div className="calc-fact">
              {rt.special.kind === '30-60-90'
                ? `short leg : long leg : hypotenuse = ${rt.special.ratio}`
                : `leg : leg : hypotenuse = ${rt.special.ratio}`}
            </div>
          </div>
        )}
      </Answer>
    </CardSection>
  )
}

function SegmentBlock({ data, k }: { data: MeasureCardData; k: (p: ShapePart) => string }) {
  const s = data.reports.seg!
  const nm = s.names.join('')
  return (
    <ul className="calc-facts">
      <li className="calc-fact calc-fact-lead">
        {nm} ={' '}
        <Answer k={k('lengths')} what="the length">
          <M m={s.length} />
        </Answer>
      </li>
      <li className="calc-fact calc-fact-lead">
        slope ={' '}
        <Answer k={k('slopes')} what="the slope">
          {s.slope.text}
        </Answer>
      </li>
      <li className="calc-fact calc-fact-lead">
        midpoint ={' '}
        <Answer k={k('midpoints')} what="the midpoint">
          {s.midpoint.text}
        </Answer>
      </li>
      <li className="calc-fact">
        <AnswerTex k={k('line')} tex={s.line.slopeIntercept.tex} what="the equation" />
      </li>
      {!s.slope.vertical && (
        <li className="calc-fact">
          <AnswerTex k={k('line')} tex={s.line.pointSlope.tex} what="the equation" />
        </li>
      )}
    </ul>
  )
}

function LineBlock({ data, k }: { data: MeasureCardData; k: (p: ShapePart) => string }) {
  const l = data.reports.line
  if (!l) return null
  return (
    <ul className="calc-facts">
      <li className="calc-fact">
        Through {l.through}, {l.rel} to {l.to}
      </li>
      <li className="calc-fact">
        <AnswerTex k={k('line')} tex={l.line.slopeIntercept.tex} what="the equation" />
      </li>
      {!l.line.slope.vertical && (
        <li className="calc-fact">
          <AnswerTex k={k('line')} tex={l.line.pointSlope.tex} what="the equation" />
        </li>
      )}
      <li className="calc-fact">
        <Answer k={k('line')} what="why">
          {l.reason}
        </Answer>
      </li>
    </ul>
  )
}

function PairBlock({
  data,
  settings,
  onMeasure,
  onAddShape,
  k,
}: {
  data: MeasureCardData
  settings: ShapeMeasureSettings | undefined
  onMeasure(next: ShapeMeasureSettings | undefined, label: string): void
  onAddShape(src: string): string | null
  k: (p: ShapePart) => string
}) {
  const p = data.reports.pair
  const plot = (pt: { x: number; y: number }): void => {
    const num = (v: number): string => String(Math.round(v * 1e9) / 1e9)
    onAddShape(`point (${num(pt.x)}, ${num(pt.y)})`)
  }
  return (
    <>
      <div className="calc-controls measure-pair">
        <label className="measure-toggles-label" htmlFor={`pair-${data.to ?? 'none'}`}>
          Measure to
        </label>
        <select
          id={`pair-${data.to ?? 'none'}`}
          className="calc-select"
          value={data.to ?? ''}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onMeasure(setMeasureTo(settings, e.target.value || null), e.target.value ? 'measure to point' : 'stop measuring')}
        >
          <option value="">— choose a point —</option>
          {data.choices.map((c) => (
            <option key={c.ref} value={c.ref}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      {data.choices.length === 0 && (
        <div className="field-hint">Add another point (Q = (4, 6)) or a shape to measure the distance to it.</div>
      )}
      {data.to && !p && <div className="calc-why">That point is no longer on the board.</div>}
      {p && (
        <ul className="calc-facts">
          <li className="calc-fact calc-fact-lead">
            distance ={' '}
            <Answer k={k('pair')} what="the distance">
              <M m={p.length} />
            </Answer>
          </li>
          <li className="calc-fact calc-fact-lead">
            slope ={' '}
            <Answer k={k('pair')} what="the slope">
              {p.slope.text}
            </Answer>
          </li>
          <li className="calc-fact calc-fact-lead">
            midpoint ={' '}
            <Answer k={k('pair')} what="the midpoint">
              {p.midpoint.text}
            </Answer>
          </li>
          <li className="calc-fact">
            <AnswerTex k={k('pair')} tex={p.line.slopeIntercept.tex} what="the line" />
          </li>
          <li className="calc-fact">
            If this point is the midpoint, the other endpoint is{' '}
            <Answer k={k('pair')} what="the endpoint">
              {p.endpointIfMid.text}{' '}
              <button type="button" className="calc-chip" title="Plot that endpoint as a new point" onClick={(e) => { e.stopPropagation(); plot(p.endpointIfMid.pt) }}>
                Plot
              </button>
            </Answer>
          </li>
          <li className="calc-fact">
            If the other point is the midpoint, the far endpoint is{' '}
            <Answer k={k('pair')} what="the endpoint">
              {p.endpointIfPartnerMid.text}{' '}
              <button type="button" className="calc-chip" title="Plot that endpoint as a new point" onClick={(e) => { e.stopPropagation(); plot(p.endpointIfPartnerMid.pt) }}>
                Plot
              </button>
            </Answer>
          </li>
        </ul>
      )}
    </>
  )
}

/** "Line through a point": pick a side and a named point, then ∥ or ⊥. */
function LineTool({ sides, points, onAddShape }: { sides: string[]; points: string[]; onAddShape(src: string): string | null }) {
  const [side, setSide] = useState(sides[0])
  const [pt, setPt] = useState(points[0])
  const [err, setErr] = useState<string | null>(null)
  const s = sides.includes(side) ? side : sides[0]
  const p = points.includes(pt) ? pt : points[0]
  const add = (rel: 'parallel' | 'perpendicular'): void => {
    setErr(onAddShape(`${rel} to ${s} through ${p}`))
  }
  return (
    <div className="secant-block">
      <div className="secant-block-title">Line through a point</div>
      <div className="calc-controls" onClick={(e) => e.stopPropagation()}>
        {sides.length > 1 ? (
          <select className="calc-select" aria-label="Side" value={s} onChange={(e) => setSide(e.target.value)}>
            {sides.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        ) : (
          <span className="calc-fact-lead">{s}</span>
        )}
        <span className="measure-toggles-label">through</span>
        <select className="calc-select" aria-label="Point" value={p} onChange={(e) => setPt(e.target.value)}>
          {points.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        <button type="button" className="calc-chip" title={`The line through ${p} parallel to ${s}`} onClick={() => add('parallel')}>
          Parallel
        </button>
        <button type="button" className="calc-chip" title={`The line through ${p} perpendicular to ${s}`} onClick={() => add('perpendicular')}>
          Perpendicular
        </button>
      </div>
      {err && <div className="calc-why">{err}</div>}
      <div className="field-hint">Or type it: parallel to {s} through {p}. The line follows when the points move.</div>
    </div>
  )
}

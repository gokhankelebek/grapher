// ============================================================================
// src/ui/ShapeCentresSection.tsx — a triangle's centres on its card
// (NC Math 2 G-CO.10).
//
//   ▾ CENTRES                                   G (8/3, 4/3) · O (3, 1)
//     Show on board  [Centroid G] [Circumcentre O] [Incentre I] [Orthocentre H] [Euler line]  All
//     G = (8/3, 4/3)     medians · inside △ABC · AG = 2·GM
//     O = (3, 1)         perpendicular bisectors · OA = OB = OC = R = √10
//     I ≈ (2.53, 1.6)    angle bisectors · r ≈ 1.44
//     H = (2, 2)         altitudes · inside
//     Euler line y = −x + 4: HG = 2·GO: 2√2/3 = 2 · √2/3
//     △ABC is acute, so all four centres lie inside it.
//
// Every value arrives computed (src/core/triangleCentres.ts); the switches say
// what is DRAWN and are stored with the shape (BoardShape.measure.centres).
// Each centre's readouts are an answer under the shape's own reveal key.
// ============================================================================

import type { CentreFlag } from '../core/types'
import type { ShapeMeasureSettings } from '../core/persist'
import type { TriangleCentres, CentreKey } from '../core/triangleCentres'
import { approxPoint, centreFacts } from '../core/triangleCentres'
import { CardSection } from './CardSection'
import { Answer } from './RevealAnswer'
import { shapeKey } from './reveal'
import { CENTRE_COLORS, centreToggles, toggleCentre } from './centreLinks'

interface Props {
  shapeId: string
  data: TriangleCentres
  settings: ShapeMeasureSettings | undefined
  onMeasure(next: ShapeMeasureSettings | undefined, label: string): void
}

const ORDER: CentreKey[] = ['centroid', 'circumcentre', 'incentre', 'orthocentre']

export function ShapeCentresSection({ shapeId, data, settings, onMeasure }: Props) {
  const toggles = centreToggles(settings)
  const allOn = toggles.every((t) => t.on)
  const k = (f: CentreFlag): string => shapeKey(shapeId, f)
  const tri = `△${data.names.join('')}`
  const summary = data.equilateral
    ? `G = O = I = H ${data.centroid.pt.text}`
    : `G ${data.centroid.pt.text} · O ${data.circumcentre.pt.text}`
  return (
    <CardSection
      kind="shape-centres"
      title="Centers"
      titleHint="Centroid, circumcenter, incenter and orthocenter — where the medians, perpendicular bisectors, angle bisectors and altitudes meet"
      summary={summary}
      answerKey={k('centroid')}
      testId="shape-centres"
    >
      <div className="measure-toggles" role="group" aria-label="Centers on the board">
        <span className="measure-toggles-label">Show on board</span>
        {toggles.map((t) => (
          <button
            key={t.flag}
            type="button"
            className={`calc-chip${t.on ? ' calc-chip-on' : ''}`}
            aria-pressed={t.on}
            title={t.hint}
            data-testid={`centre-${t.flag}`}
            onClick={(e) => {
              e.stopPropagation()
              onMeasure(toggleCentre(settings, t.flag), `${t.on ? 'hide' : 'show'} ${t.label.toLowerCase()}`)
            }}
          >
            <span className="centre-swatch" style={{ background: CENTRE_COLORS[t.flag] }} aria-hidden="true" />
            {t.label}
          </button>
        ))}
        <button
          type="button"
          className="calc-chip measure-all"
          title={allOn ? 'Draw none of the centers' : 'Draw all four centers and the Euler line'}
          onClick={(e) => {
            e.stopPropagation()
            onMeasure(toggleCentre(settings, allOn ? 'none' : 'all'), allOn ? 'hide centers' : 'show centers')
          }}
        >
          {allOn ? 'None' : 'All'}
        </button>
      </div>
      <ul className="calc-facts centre-list">
        {ORDER.map((key) => {
          const c = data[key]
          return (
            <li key={key} className="calc-fact centre-row" data-testid={`centre-row-${key}`}>
              <span className="centre-name">
                <span className="centre-swatch" style={{ background: CENTRE_COLORS[key] }} aria-hidden="true" />
                {c.name[0].toUpperCase() + c.name.slice(1)}
              </span>
              <Answer k={k(key)} what={`the ${c.name}`}>
                <span className="calc-fact-lead">
                  {c.letter} {c.exact ? '=' : '≈'} {c.exact ? c.pt.text : approxPoint(c.pt)}
                </span>
                {c.exact && /[√]/.test(c.pt.text) && <span className="measure-approx"> ≈ {approxPoint(c.pt)}</span>}
                {centreFacts(data, key).map((f, i) => (
                  <span key={i} className="centre-fact">
                    {' '}
                    {f}
                  </span>
                ))}
              </Answer>
            </li>
          )
        })}
      </ul>
      <div className="secant-block">
        <div className="secant-block-title">Euler line</div>
        <Answer k={k('euler')} block what="the Euler line">
          {data.euler ? (
            <>
              <div className="calc-fact calc-fact-lead">
                O, G and H lie on one line: {data.euler.line.slopeIntercept.text}
              </div>
              <div className="calc-fact">{data.euler.ratioText}</div>
            </>
          ) : (
            <div className="calc-fact">
              {tri} is equilateral: O = G = H, so there is no Euler line — every center is {data.centroid.pt.text}.
            </div>
          )}
        </Answer>
      </div>
      <Answer k={k('circumcentre')} block what="what this triangle's centers do">
        <ul className="calc-facts">
          {data.notes.map((n, i) => (
            <li key={i} className="calc-fact measure-sentence">
              {n}
            </li>
          ))}
        </ul>
      </Answer>
      <div className="field-hint">Drag a vertex: every center, line and circle follows.</div>
    </CardSection>
  )
}

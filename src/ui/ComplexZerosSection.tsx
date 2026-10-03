// ============================================================================
// src/ui/ComplexZerosSection.tsx — "Zeros over ℂ" on a polynomial's card
// (NC.M2/M3.N-CN.9, NC.M2.A-REI.4b).
//
//   ▸ ZEROS OVER ℂ   degree 3 = 1 real + 2 non-real
//     Degree 3: 3 zeros counted with multiplicity — 1 real, 2 non-real (1 conjugate pair).
//     x = 1
//     x = −1/2 ± (√3/2)i
//     x² + x + 1: b² − 4ac = 1² − 4(1)(1) = −3 · −3 < 0: two non-real zeros
//     ▸ how: rational root theorem, synthetic division, the quadratic formula
//     The real zeros are where the graph crosses or touches the x-axis; …
//
// Everything arrives computed (src/core/complexZeros.ts via ./complexLinks.ts);
// the section has no settings and stores nothing. Every value is an answer:
// one reveal key for the section (complexKey).
// ============================================================================

import { useState } from 'react'
import type { ComplexZeros } from '../core/complexZeros'
import { multiplicityWord } from '../core/complexZeros'
import { CardSection } from './CardSection'
import { Latex } from './Latex'
import { Answer, useReveal } from './RevealAnswer'
import { complexKey } from './reveal'
import { complexSummary } from './complexLinks'

const GENERIC_NOTE = 'Real zeros are where the graph crosses or touches the x-axis; non-real zeros do not appear on the graph.'

export function ComplexZerosSection({ curveId, zeros }: { curveId: string; zeros: ComplexZeros }) {
  const k = complexKey(curveId)
  const [how, setHow] = useState(false)
  const d = zeros.discriminant
  const r = useReveal()
  // the note's counts are answers too; hidden, it says only what is always true
  const note = r.on && r.hidden(k) ? GENERIC_NOTE : zeros.graphNote
  return (
    <CardSection
      kind="complex-zeros"
      title="Zeros over ℂ"
      titleHint="Every zero of the polynomial, real and non-real, counted with multiplicity (the Fundamental Theorem of Algebra)"
      summary={complexSummary(zeros)}
      answerKey={k}
      testId="complex-zeros"
    >
      <div className="calc-fact calc-fact-lead" data-testid="complex-fta">
        <Answer k={k} what="the count of zeros">
          {zeros.fta}
        </Answer>
      </div>
      <Answer k={k} block quiet>
        <ul className="calc-facts cz-list" aria-label="The zeros">
          {zeros.zeros.map((z, i) => (
            <li key={`${z.text}-${i}`} className="calc-fact cz-zero" data-testid="complex-zero" data-kind={z.kind}>
              <span className="cz-x">{z.exact ? <Latex tex={`x = ${z.tex}`} /> : <Latex tex={`x \\approx ${z.tex}`} />}</span>
              {z.mult > 1 && <span className="cz-muted"> {multiplicityWord(z.mult)}</span>}
              {z.kind === 'complex-pair' && <span className="cz-muted"> — not on the graph</span>}
            </li>
          ))}
        </ul>
        {d && (
          <div className="calc-fact cz-disc" data-testid="complex-discriminant">
            {zeros.degree > 2 && <span className="cz-muted">{`${d.of.text}: `}</span>}
            <span className="cz-disc-eq">{d.text}</span>
            <div className="cz-muted">{`${d.sentence.charAt(0).toUpperCase()}${d.sentence.slice(1)}.`}</div>
          </div>
        )}
        {zeros.steps.length > 0 && (
          <div className="cz-how">
            <button
              type="button"
              className={`calc-chip${how ? ' calc-chip-on' : ''}`}
              aria-expanded={how}
              data-testid="complex-how"
              onClick={(e) => {
                e.stopPropagation()
                setHow(!how)
              }}
            >
              How
            </button>
            {how && (
              <ol className="solve-steps cz-steps">
                {zeros.steps.map((s, i) => (
                  <li key={i} className="solve-step">
                    {s}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </Answer>
      <div className="calc-fact cz-note" data-testid="complex-graph-note">
        {note}
      </div>
    </CardSection>
  )
}

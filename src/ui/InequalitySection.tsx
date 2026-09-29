// ============================================================================
// src/ui/InequalitySection.tsx — what an inequality's card says.
//
//   ▾ INEQUALITY
//     Boundary  y = x² − 4   dashed
//     Shaded below y = x² − 4, boundary dashed (strict)
//     Test (0, 0): 0 < 0² − 4 → 0 < −4 ✗ → shade the side without the origin
//
// The classic teaching move, in order: graph the boundary (dashed for < and >,
// solid for ≤ and ≥), test a point off it, shade the side that works. Every
// string comes from src/core/inequality2d.ts describeInequality().
// ============================================================================

import { CardSection } from './CardSection'
import { Latex } from './Latex'
import type { InequalityInfo } from '../core/types'
import { describeInequality } from '../core/inequality2d'

interface Props {
  info: InequalityInfo
}

export function InequalitySection({ info }: Props) {
  const d = describeInequality(info)
  return (
    <CardSection kind="inequality" title="Inequality" summary={d.shade} testId="ineq-section">
      <div className="ineq-lines" data-testid="ineq-lines">
        {d.boundaries.map((b, i) => (
          <div className="ineq-boundary" key={i}>
            <span className="calc-tag">{d.boundaries.length > 1 ? `Boundary ${i + 1}` : 'Boundary'}</span>
            <Latex tex={b.latex} className="ineq-latex" />
            <span className={`ineq-dash ${b.dashed ? 'ineq-dashed' : 'ineq-solid'}`} title={b.dashed ? 'Strict (< or >): points on the boundary are not solutions' : 'Inclusive (≤ or ≥): points on the boundary are solutions'}>
              {b.dashed ? 'dashed' : 'solid'}
            </span>
          </div>
        ))}
        <div className="ineq-shade" data-testid="ineq-shade">
          {d.shade}
        </div>
        {d.test && (
          <div className={`ineq-test ${d.test.ok ? 'ineq-ok' : 'ineq-no'}`} data-testid="ineq-test">
            {d.test.note && <div className="field-hint">{d.test.note}</div>}
            {d.test.text}
          </div>
        )}
      </div>
    </CardSection>
  )
}

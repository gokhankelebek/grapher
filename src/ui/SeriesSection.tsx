// ============================================================================
// src/ui/SeriesSection.tsx — Σ aₙ on a sequence's card ("Σ Show series").
//
//   ▾ SERIES                                                    ×
//     Σ_{n=1}^∞ 1/n²                                  (KaTeX)
//     N  −  ━━━━━━━●━━━━━━━  +   20
//     S₂₀ ≈ 1.596163
//     S = π²/6 ≈ 1.644934
//     CONVERGES — p-series
//     Σ 1/n² is a p-series with p = 2 > 1, so it converges.
//     [join the sums] [staircase bars] [Show all tests ▸]
//
// Everything printed arrives worked out (src/ui/seqLinks.ts seriesCard ←
// src/core/series.ts); every edit leaves as one patch of the series view.
// The only state kept here is whether the list of tests is open.
// ============================================================================

import { useState } from 'react'
import type { CSSProperties } from 'react'
import { Latex } from './Latex'
import { CardSection, SectionDrop } from './CardSection'
import type { SeqSeriesView, SeriesCardData } from './seqLinks'

interface Props {
  data: SeriesCardData
  /** The partial sums' colour on the board (the squares). */
  color: string
  /** A change to the series view; `live` while a slider is being dragged. */
  onChange(patch: Partial<SeqSeriesView>, live?: boolean): void
  onRemove(): void
  /** One undo bracket around a slider drag. */
  onEditStart(): void
  onEditEnd(): void
}

function fillStyle(value: number, min: number, max: number): CSSProperties {
  const span = max - min || 1
  const pct = Math.max(0, Math.min(100, ((value - min) / span) * 100))
  return { '--fill': `${pct}%` } as CSSProperties
}

export function SeriesSection({ data, color, onChange, onRemove, onEditStart, onEditEnd }: Props) {
  const [allOpen, setAllOpen] = useState(false)
  const setN = (n: number): void => {
    const v = Math.max(data.Nmin, Math.min(data.Nmax, Math.round(n)))
    if (v !== data.N) onChange({ N: v })
  }
  const summary = [data.verdictText, data.sumText].filter(Boolean).join(' · ')
  return (
    <CardSection
      kind="series"
      title="Series"
      titleHint="The infinite series Σ aₙ: partial sums, the sum, and the convergence tests"
      summary={summary}
      actions={<SectionDrop what="series" onRemove={onRemove} />}
      className="calc-row series-row"
      testId="series-section"
      data={{ verdict: data.verdict }}
    >
      <div className="taylor-tex series-tex">
        <Latex tex={data.tex} />
      </div>

      {data.problem ? (
        <div className="calc-why">{data.problem}</div>
      ) : (
        <>
          <div className="taylor-n series-n">
            <span className="calc-n-label">N</span>
            <button
              type="button"
              className="calc-chip taylor-step"
              aria-label="One term fewer"
              title="One term fewer"
              disabled={data.N <= data.Nmin}
              onClick={() => setN(data.N - 1)}
            >
              −
            </button>
            <input
              type="range"
              min={data.Nmin}
              max={data.Nmax}
              step={1}
              value={data.N}
              aria-label="Partial sums up to N"
              data-testid="series-n"
              style={fillStyle(data.N, data.Nmin, data.Nmax)}
              onPointerDown={onEditStart}
              onPointerUp={onEditEnd}
              onKeyDown={onEditStart}
              onKeyUp={onEditEnd}
              onBlur={onEditEnd}
              onChange={(e) => onChange({ N: Number(e.target.value) }, true)}
            />
            <button
              type="button"
              className="calc-chip taylor-step"
              aria-label="One term more"
              title="One term more"
              disabled={data.N >= data.Nmax}
              onClick={() => setN(data.N + 1)}
            >
              +
            </button>
            <span className="calc-n-value">{data.N}</span>
            <span />
          </div>

          <ul className="calc-facts series-facts" data-testid="series-facts">
            <li className="calc-fact calc-fact-lead">
              <span className="series-swatch" style={{ background: color }} aria-hidden="true" />
              {data.sNText.startsWith('≈') ? `${data.sNLabel} ${data.sNText}` : `${data.sNLabel} = ${data.sNText}`}
            </li>
            {data.sumText && (
              <li className="calc-fact calc-fact-lead" data-testid="series-sum" title={data.sumHow ?? undefined}>
                {data.sumText}
              </li>
            )}
            {data.bound && (
              <li className="calc-fact calc-fact-lead" data-testid="series-bound">
                {data.bound}
              </li>
            )}
            {data.actual && <li className="calc-fact">{data.actual}</li>}
          </ul>

          <div className={`series-verdict series-verdict-${data.verdict}`} data-testid="series-verdict">
            <span className="series-verdict-word">{data.verdictText}</span>
            {data.testName && <span className="series-verdict-test"> — {data.testName}</span>}
          </div>
          <div className="series-why" data-testid="series-why">
            {data.justification}
          </div>
          {data.sumNote && <div className="series-note">{data.sumNote}</div>}

          <div className="calc-controls">
            <button
              type="button"
              className={`calc-chip${data.connect ? ' calc-chip-on' : ''}`}
              aria-pressed={data.connect}
              title="Join the partial sums (n, Sₙ) with a line"
              onClick={() => onChange({ connect: !data.connect })}
            >
              join the sums
            </button>
            <button
              type="button"
              className={`calc-chip${data.bars ? ' calc-chip-on' : ''}`}
              aria-pressed={data.bars}
              title="Draw each term as a bar stacked on the sum before it — the staircase of Sₙ"
              onClick={() => onChange({ bars: !data.bars })}
            >
              staircase bars
            </button>
            {data.tests.length > 0 && (
              <button
                type="button"
                className={`calc-chip${allOpen ? ' calc-chip-on' : ''}`}
                aria-expanded={allOpen}
                data-testid="series-all-btn"
                title="Every convergence test, in the AP order, with what it says here"
                onClick={() => setAllOpen((o) => !o)}
              >
                {allOpen ? 'Hide tests' : 'Show all tests'}
              </button>
            )}
          </div>

          {allOpen && (
            <ol className="series-tests" data-testid="series-tests">
              {data.tests.map((t) => (
                <li key={t.id} className={`series-test series-test-${t.outcome}`}>
                  <div className="series-test-head">
                    <span className="series-test-name">{t.name}</span>
                    <span className={`series-outcome series-outcome-${t.outcome}`}>{t.outcomeText}</span>
                  </div>
                  <div className="series-test-why">{t.reason}</div>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </CardSection>
  )
}

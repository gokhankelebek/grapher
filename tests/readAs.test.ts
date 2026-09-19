// ============================================================================
// tests/readAs.test.ts — the number beside a ranked list.
//
// The Interpretations list printed σ next to each candidate. The list is
// ordered by a model-selection score, and σ is NOT monotone in that order, so
// the column rose and fell down a ranked list and read as a broken table.
// fitQuality is monotone by construction; this pins the property the row
// depends on, and the way the card renders it.
// ============================================================================

import { describe, it, expect } from 'vitest'
import type { FitResult } from '../src/core/types'
import { fitQuality } from '../src/core/fit/recognize'
import { qualityText } from '../src/ui/CurveCard'

const cand = (modelId: string, score: number, error: number): FitResult => ({
  modelId,
  params: [1],
  kind: 'explicit',
  domain: null,
  error,
  score,
})

describe('fitQuality, as the Read-as row shows it', () => {
  it('is 1 for the best reading and never rises down the list', () => {
    // σ deliberately does NOT descend here — that is the whole point.
    const ranked = [
      cand('poly3', -120, 0.031),
      cand('poly4', -108, 0.019),
      cand('sine', -95, 0.042),
    ]
    const q = fitQuality(ranked)
    expect(q[0]).toBe(1)
    for (let i = 1; i < q.length; i++) expect(q[i]).toBeLessThanOrEqual(q[i - 1])
    expect(ranked[1].error).toBeLessThan(ranked[0].error) // σ is not the story
  })

  it('renders as a percentage a teacher can act on', () => {
    expect(qualityText(1)).toBe('100%')
    expect(qualityText(0.6234)).toBe('62%')
    // anything that survived the ranking fits at least a little
    expect(qualityText(0.0001)).toBe('1%')
  })

  it('says nothing rather than something false about a candidate with no score', () => {
    expect(qualityText(0)).toBe('—')
    expect(qualityText(Number.NaN)).toBe('—')
  })
})

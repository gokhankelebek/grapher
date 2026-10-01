// ============================================================================
// src/app/useCardCrossings.ts — each card's list of crossings, kept stable while unchanged.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useCallback, useRef } from 'react'
import { cardIntersections } from '../ui/intersections'
import type { CurveIntersections } from '../ui/intersections'
import { keepStable } from '../ui/stableProps'
import type { BoardRefsApi } from './useBoardRefs'
import type { CalcLinksApi } from './useCalcLinks'
import type { CurveNamesApi } from './useCurveNames'
import type { BoardLookApi } from './useBoardLook'

/** What useCardCrossings reads from the hooks App calls before it. */
export interface CardCrossingsDeps {
  refs: BoardRefsApi
  calc: CalcLinksApi
  naming: CurveNamesApi
  lookApi: BoardLookApi
}

export function useCardCrossings({ refs, calc, naming, lookApi }: CardCrossingsDeps) {
  const { curvesRef } = refs
  const { curveLabel } = calc
  const { boardCurveNames } = naming
  const { crossings } = lookApi

  /** Per card, the last list handed out — reused while its contents are the same. */
  const crossingsForCacheRef = useRef(new Map<string, readonly CurveIntersections[]>())
  const crossingsFor = useCallback(
    (id: string): readonly CurveIntersections[] | undefined => {
      if (crossings.length === 0) return undefined
      const got = cardIntersections(
        id,
        crossings,
        (other) => {
          const c = curvesRef.current.find((k) => k.id === other)
          return boardCurveNames[other] ?? (c ? curveLabel(c) : other)
        },
        curvesRef.current.map((c) => c.id),
      )
      if (got.length === 0) return undefined
      const cache = crossingsForCacheRef.current
      const stable = keepStable(cache.get(id), got)
      cache.set(id, stable)
      return stable
    },
    [crossings, boardCurveNames, curveLabel],
  )

  return {
    crossingsFor,
  }
}

export type CardCrossingsApi = ReturnType<typeof useCardCrossings>

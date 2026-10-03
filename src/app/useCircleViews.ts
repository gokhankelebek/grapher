// ============================================================================
// src/app/useCircleViews.ts — the "Circle theorems" section of every circle's
// card: its panel (selected card only) and its edits.
//
// The settings live in board.circleViews (one CircleView per circle: the
// points as typed, which figures are drawn); saved with the document in
// board.curveViews and never an undo step, like the Table section. What the
// board draws is built in useBoardOverlays (circleOverlays), so it reaches the
// screen and every export through the one overlay list.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useCallback, useMemo } from 'react'
import type { CircleView } from '../core/persist'
import { patchCircleView } from '../ui/curveViews'
import type { CircleActions } from '../ui/CircleSection'
import type { CirclePanel } from '../ui/circleLinks'
import { circlePanel } from '../ui/circleLinks'
import type { BoardStateApi } from './useBoardState'
import type { DocumentStateApi } from './useDocumentState'

/** What useCircleViews reads from the hooks App calls before it. */
export interface CircleViewsDeps {
  board: BoardStateApi
  docState: DocumentStateApi
}

export function useCircleViews({ board, docState }: CircleViewsDeps) {
  const { curves, kind, selectedId, circleViews, setCircleViews, circleViewsRef } = board
  const { exprSources } = docState

  // ---- the selected card's panel: only it is open, so only it is computed
  const panel = useMemo<CirclePanel | undefined>(() => {
    if (kind !== 'cartesian' || !selectedId) return undefined
    const c = curves.find((k) => k.id === selectedId)
    if (!c) return undefined
    try {
      return circlePanel(c, exprSources[c.id], circleViews[c.id]) ?? undefined
    } catch {
      return undefined
    }
  }, [kind, selectedId, curves, circleViews, exprSources])
  const circlePanelFor = useCallback(
    (id: string): CirclePanel | undefined => (panel && panel.curveId === id ? panel : undefined),
    [panel],
  )

  /** Replace one circle's stored settings (never an undo step; saved with the document). */
  const setCircleView = useCallback((curveId: string, next: CircleView): void => {
    const patch: Partial<Record<keyof CircleView, unknown>> = {
      pts: next.pts,
      show: next.show,
      at: next.at,
      ext: next.ext,
    }
    const m = patchCircleView(circleViewsRef.current, curveId, patch)
    if (m === circleViewsRef.current) return
    circleViewsRef.current = m
    setCircleViews(m)
  }, [])

  const circleActions = useMemo<CircleActions>(() => ({ set: setCircleView }), [setCircleView])

  return { circlePanelFor, circleActions, setCircleView }
}

export type CircleViewsApi = ReturnType<typeof useCircleViews>

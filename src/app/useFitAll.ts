// ============================================================================
// src/app/useFitAll.ts — "Fit to curves" (⤢ and the zoomFit command) that
// frames the GEOMETRY too: polygons, segments, points, images and their
// construction aids (a rotation's centre and arc, a dilation's rays), a
// triangle's centres (the circumcircle reaches past the triangle) and a
// circle's theorems.
//
// The rest of the board is measured exactly as useViewport's fit measures it
// (fitContentBox): each curve by its FEATURES (src/ui/fitFrame.ts), never by
// its extent across the window, and the solution curves of a field, data
// tables, sequences, unit circles, related rates, statistics, the Euler steps
// and the calculus tools' key points. The geometry is measured as the fitted
// export measures it (shapesBox / overlaysBox). A board with no geometry on it
// fits exactly as useViewport.fitToContent does.
//
// The export's own content box (useExport's exportContent) is NOT used here:
// it measures each curve across the whole window — right for an exported
// figure, wrong for a button that should show where the curve's features are.
//
// Called once per render by App (src/App.tsx), after useExport.
// ============================================================================

import { useCallback } from 'react'
import { unionBoxes } from '../ui/curveState'
import { overlaysBox, shapesBox } from '../ui/exportFit'
import type { Box } from '../ui/viewScale'
import type { BoardRefsApi } from './useBoardRefs'
import type { ModelsApi } from './useModels'
import type { FieldsApi } from './useFields'
import type { ShapesApi } from './useShapes'
import type { ViewportApi } from './useViewport'

export interface FitAllDeps {
  refs: BoardRefsApi
  derived: ModelsApi
  fieldsApi: FieldsApi
  shapesApi: ShapesApi
  viewport: ViewportApi
  /** The board's geometry overlays (centres, circle theorems): useBoardOverlays. */
  geometryMarksRef: { current: Parameters<typeof overlaysBox>[0] }
  /**
   * The fitted export's content box (useExport). No longer read: it measures
   * curves across the window, which is what this fit must not do. Kept so
   * the call site in App compiles unchanged; safe to drop there.
   */
  exportContent?: () => Box | null
}

export function useFitAll({ refs, shapesApi, viewport, geometryMarksRef }: FitAllDeps) {
  const { kindRef } = refs
  const { shapeSceneRef } = shapesApi
  const { fitToContent, fitContentBox, frameBox } = viewport

  return useCallback((): void => {
    if (kindRef.current !== 'cartesian') return fitToContent()
    const geometry = unionBoxes([shapesBox(shapeSceneRef.current), overlaysBox(geometryMarksRef.current)])
    if (!geometry) return fitToContent()
    const box = unionBoxes([fitContentBox(), geometry])
    if (box) frameBox(box)
    else fitToContent()
  }, [fitToContent, fitContentBox, frameBox])
}

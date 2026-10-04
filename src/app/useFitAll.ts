// ============================================================================
// src/app/useFitAll.ts — "Fit to curves" (⤢ and the zoomFit command) that
// frames the GEOMETRY too: polygons, segments, points, images and their
// construction aids (a rotation's centre and arc, a dilation's rays), a
// triangle's centres (the circumcircle reaches past the triangle) and a
// circle's theorems.
//
// The measurement is the fitted export's (useExport's exportContent, which
// already takes the geometry in), so the screen and an exported figure frame
// the same things; with what only the screen's fit adds — the solution
// curves of a field, the Euler steps and the calculus tools' key points —
// taken in as useViewport's fit takes them. A board with no geometry on it
// fits exactly as it always did (useViewport.fitToContent).
//
// Called once per render by App (src/App.tsx), after useExport.
// ============================================================================

import { useCallback } from 'react'
import { unionBoxes } from '../ui/curveState'
import { eulerFramePoints } from '../ui/eulerLinks'
import { overlaysBox, shapesBox } from '../ui/exportFit'
import type { Box } from '../ui/viewScale'
import { calcFramePoints, withPoints } from '../ui/viewScale'
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
  /** The fitted export's content box: useExport. */
  exportContent: () => Box | null
}

/** The box a set of polylines' finite points occupy. */
function polylinesBox(polys: readonly { pts: readonly { x: number; y: number }[] }[]): Box | null {
  let out: Box | null = null
  for (const poly of polys) {
    for (const p of poly.pts) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
      if (!out) out = { min: { ...p }, max: { ...p } }
      else {
        out.min.x = Math.min(out.min.x, p.x)
        out.min.y = Math.min(out.min.y, p.y)
        out.max.x = Math.max(out.max.x, p.x)
        out.max.y = Math.max(out.max.y, p.y)
      }
    }
  }
  return out
}

export function useFitAll({ refs, derived, fieldsApi, shapesApi, viewport, geometryMarksRef, exportContent }: FitAllDeps) {
  const { kindRef, calcRef, curvesRef } = refs
  const { modelsRef } = derived
  const { eulerPathsRef, fieldPolylinesRef } = fieldsApi
  const { shapeSceneRef } = shapesApi
  const { fitToContent, frameBox } = viewport

  return useCallback((): void => {
    if (kindRef.current !== 'cartesian') return fitToContent()
    const geometry = unionBoxes([shapesBox(shapeSceneRef.current), overlaysBox(geometryMarksRef.current)])
    if (!geometry) return fitToContent()
    let keyPts = eulerFramePoints(eulerPathsRef.current)
    try {
      keyPts = keyPts.concat(calcFramePoints(calcRef.current, curvesRef.current, modelsRef.current))
    } catch {
      /* the key points are extra; the rest still frames */
    }
    const box = withPoints(unionBoxes([exportContent(), polylinesBox(fieldPolylinesRef.current), geometry]), keyPts)
    if (box) frameBox(box)
    else fitToContent()
  }, [fitToContent, frameBox, exportContent])
}

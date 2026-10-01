// ============================================================================
// src/app/usePresentation.ts — what the render needs last: presentation scale, the legend, undo state.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useCallback, useMemo } from 'react'
import { isCurveLink, labelLegend } from '../ui/calcLinks'
import { dataLegend } from '../ui/dataLinks'
import { eulerLegend } from '../ui/eulerLinks'
import { fieldLegend } from '../ui/fieldLinks'
import { inputTex, solveCached } from '../ui/nlSolve'
import { curveLegend, itemLegend, presentScale } from '../ui/present'
import { calcKey, isHidden, maskTex, solveKey } from '../ui/reveal'
import { sequenceLegend } from '../ui/seqLinks'
import { shapeLegend } from '../ui/shapeLinks'
import { clampPresentScale, updatePrefs } from '../ui/storage'
import type { BoardStateApi } from './useBoardState'
import type { DocumentStateApi } from './useDocumentState'
import type { SessionStateApi } from './useSessionState'
import type { BoardRefsApi } from './useBoardRefs'
import type { ModelsApi } from './useModels'
import type { FieldsApi } from './useFields'
import type { ShapesApi } from './useShapes'
import type { DataTablesApi } from './useDataTables'

/** What usePresentation reads from the hooks App calls before it. */
export interface PresentationDeps {
  board: BoardStateApi
  docState: DocumentStateApi
  session: SessionStateApi
  refs: BoardRefsApi
  derived: ModelsApi
  fieldsApi: FieldsApi
  shapesApi: ShapesApi
  tables: DataTablesApi
}

export function usePresentation({ board, docState, session, refs, derived, fieldsApi, shapesApi, tables }: PresentationDeps) {
  const { curves, kind, items, styles, calcLinks, fields, shapes, dataSets, sequences } = board
  const { displaySources } = docState
  const { reveal, presentMode, presentType, setPresentType } = session
  const { undoRef, redoRef } = refs
  const { models } = derived
  const { fieldCompiled } = fieldsApi
  const { shapeCompiled } = shapesApi
  const { seqCompiled } = tables

  // ------------------------------------------------------------------ render
  const canUndo = undoRef.current.length > 0
  const canRedo = redoRef.current.length > 0

  /**
   * The presentation scaling handed to both stages. Null at 1:1, so a board
   * that is not being presented builds exactly the scene it built before.
   */
  const present = useMemo(
    () => (presentMode ? presentScale(presentType) : null),
    [presentMode, presentType],
  )

  /** Each visible curve's equation, in its own colour, for the legend. */
  const legend = useMemo(
    () =>
      !presentMode
        ? []
        : kind === 'number-line'
          ? itemLegend(items)
          // A derived curve's equation does not say what it IS: two cubic-ish
          // chips on a wall and the class has to guess which is f and which
          // is f′. The chip says so.
          : [
              ...labelLegend(curveLegend(curves, models, displaySources), calcLinks),
              // A lattice says nothing about the equation that drew it, and a
              // field has no card on the wall. Two fields projected side by
              // side would otherwise be two grey textures.
              ...fieldLegend(fields, fieldCompiled),
              // Each Euler run by its step: "Euler's method, h = 0.5".
              ...eulerLegend(fields, fieldCompiled),
              // And a shape: △ABC on the wall, so the class knows which
              // triangle the lesson is about when two are on the board.
              ...shapeLegend(shapes, shapeCompiled),
              // And a table, by name, in its colour: the dots on the wall
              // are "Table 1", and its fit is the curve chip beside it.
              ...dataLegend(dataSets),
              // And a sequence, by its definition: the dots on the wall are aₙ.
              ...sequenceLegend(sequences, seqCompiled),
            ],
    [
      presentMode,
      kind,
      items,
      curves,
      models,
      displaySources,
      calcLinks,
      fields,
      fieldCompiled,
      shapes,
      shapeCompiled,
      dataSets,
      sequences,
      seqCompiled,
    ],
  )

  /**
   * The legend in reveal mode: a chip whose equation IS a computed answer — a
   * Taylor polynomial, a tangent line, f′, a solved inequality's set — says
   * "= ?" until that answer is revealed. Typed equations are never touched.
   */
  const legendShown = useMemo(() => {
    if (!reveal.on || legend.length === 0) return legend
    const hide = (k: string): boolean => isHidden(reveal, k)
    return legend.map((e) => {
      if (kind === 'number-line') {
        const it = items.find((i) => i.id === e.id)
        if (it?.kind !== 'solve' || !hide(solveKey(it.id))) return e
        const res = solveCached(it.src)
        return res.ok ? { ...e, tex: `${inputTex(res)}\\quad\\Longrightarrow\\quad ?` } : e
      }
      const link = calcLinks.find((l) => isCurveLink(l) && l.curveId === e.id)
      return link && hide(calcKey(link.id)) ? { ...e, tex: maskTex(e.tex) } : e
    })
  }, [reveal, legend, kind, items, calcLinks])

  const changePresentType = useCallback((next: number): void => {
    const clean = clampPresentScale(next)
    setPresentType(clean)
    updatePrefs({ presentScale: clean })
  }, [])

  const hasBoardContent =
    kind === 'number-line'
      ? items.length > 0
      : curves.length > 0 ||
        fields.length > 0 ||
        shapes.length > 0 ||
        dataSets.length > 0 ||
        sequences.length > 0

  /** What every number-line card needs to speak for its whole answer. */
  const answerBoard = useMemo(() => ({ items, styles }), [items, styles])

  return {
    canUndo, canRedo, present, legendShown, changePresentType, hasBoardContent, answerBoard,
  }
}

export type PresentationApi = ReturnType<typeof usePresentation>

// ============================================================================
// src/app/useSidebarEditors.ts — the sidebar's editors, and the selection's sidebar actions.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useCallback } from 'react'
import type { BuilderKey } from '../ui/commands'
import type { BoardStateApi } from './useBoardState'
import type { SessionStateApi } from './useSessionState'
import type { BoardRefsApi } from './useBoardRefs'
import type { NoticesApi } from './useNotices'
import type { DocumentActionsApi } from './useDocumentActions'
import type { CurveEditingApi } from './useCurveEditing'
import type { FieldsApi } from './useFields'
import type { ShapesApi } from './useShapes'
import type { TypedLinesApi } from './useTypedLines'
import type { DataTablesApi } from './useDataTables'
import type { NumberLineApi } from './useNumberLine'
import type { UnitCircleApi } from './useUnitCircle'
import type { RelatedRatesApi } from './useRelatedRates'
import { prefersReducedMotion } from '../ui/motionPref'

/** What useSidebarEditors reads from the hooks App calls before it. */
export interface SidebarEditorsDeps {
  board: BoardStateApi
  session: SessionStateApi
  refs: BoardRefsApi
  notices: NoticesApi
  docActions: DocumentActionsApi
  editing: CurveEditingApi
  fieldsApi: FieldsApi
  shapesApi: ShapesApi
  typed: TypedLinesApi
  tables: DataTablesApi
  numberLine: NumberLineApi
  unitCircle: UnitCircleApi
  rates: RelatedRatesApi
}

export function useSidebarEditors({ board, session, refs, notices, docActions, editing, fieldsApi, shapesApi, typed, tables, numberLine, unitCircle, rates }: SidebarEditorsDeps) {
  const {
    setSelectedId, setSidebarOpen, setExprOpen, setFactorOpen, setExpOpen, setLogisticOpen,
    setLogOpen, setSinOpen, setTransformOpen, setPiecewiseOpen, setConicOpen, setMotionOpen,
    setSeqOpen,
  } = board
  const { setPresentMode, setExprSeed } = session
  const { kindRef, selectedRef, fieldsRef, shapesRef, dataRef, seqRef, ucRef, rrRef } = refs
  const { showToast } = notices
  const { importDocument } = docActions
  const { deleteCurve } = editing
  const { deleteField } = fieldsApi
  const { deleteShape } = shapesApi
  const { deleteSequence } = typed
  const { deleteData } = tables
  const { deleteItem } = numberLine
  const { deleteUnitCircle } = unitCircle
  const { deleteRelatedRates } = rates

  // ------------------------------------------------- editors in the sidebar
  /**
   * Open (or toggle) one of the sidebar's editors — the + box or a Build ▾
   * builder — and close the others: one editor at the top of the list at a
   * time. `null` closes them all. The + box's seed is cleared: only the
   * command palette's typeLine sets one.
   */
  const showBuilder = useCallback((which: BuilderKey | null, mode: 'toggle' | 'open'): void => {
    type SetBool = (v: boolean | ((o: boolean) => boolean)) => void
    const setters: Record<BuilderKey, SetBool> = {
      expr: setExprOpen,
      factor: setFactorOpen,
      exp: setExpOpen,
      logistic: setLogisticOpen,
      log: setLogOpen,
      sin: setSinOpen,
      transform: setTransformOpen,
      piecewise: setPiecewiseOpen,
      conic: setConicOpen,
      motion: setMotionOpen,
      seq: setSeqOpen,
    }
    for (const k of Object.keys(setters) as BuilderKey[]) {
      if (k === which) setters[k](mode === 'toggle' ? (o) => !o : true)
      else setters[k](false)
    }
    setExprSeed(null)
  }, [])

  /** An editor is about to open: make the sidebar it lives in visible. */
  const revealSidebar = useCallback((): void => {
    setPresentMode(false)
    setSidebarOpen(true)
  }, [])

  /** The + box, open (with `seed` typed in it, caret at the end). */
  const typeLine = useCallback(
    (seed?: string): void => {
      revealSidebar()
      showBuilder('expr', 'open')
      if (seed) setExprSeed({ text: seed, key: Date.now() })
    },
    [revealSidebar, showBuilder],
  )

  /**
   * Delete whatever is selected — a curve, a field, a shape, a table, a
   * sequence, the unit circle, a related-rates problem, or a number-line item.
   * The Delete key and the palette's "Delete the selection".
   */
  const deleteSelection = useCallback((): void => {
    const id = selectedRef.current
    if (!id) return
    if (kindRef.current === 'number-line') deleteItem(id)
    else if (fieldsRef.current.some((f) => f.id === id)) deleteField(id)
    else if (shapesRef.current.some((sh) => sh.id === id)) deleteShape(id)
    else if (dataRef.current.some((d) => d.id === id)) deleteData(id)
    else if (seqRef.current.some((q) => q.id === id)) deleteSequence(id)
    else if (ucRef.current.some((u) => u.id === id)) deleteUnitCircle(id)
    else if (rrRef.current.some((r) => r.id === id)) deleteRelatedRates(id)
    else deleteCurve(id)
    // deleteUnitCircle / deleteRelatedRates read refs only, as in the Delete key's handler
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteCurve, deleteField, deleteShape, deleteData, deleteSequence, deleteItem])

  /**
   * "Domain & range" / "Restrict the domain…" from the palette: the function's
   * own rows on its own card, brought into view (and the restrict editor
   * opened). The card is the one place those rows live, so this selects the
   * curve, opens its Analysis section if it was folded, and presses the same
   * Restrict button the teacher would.
   */
  const showDomain = useCallback(
    (id: string, restrict: boolean): void => {
      revealSidebar()
      setSelectedId(id)
      let tries = 0
      const find = (): void => {
        const card = document.querySelector<HTMLElement>('.sidebar .card-selected')
        const rows = card?.querySelector<HTMLElement>('[data-testid="domain-section"]')
        if (!card || !rows) {
          const section = card?.querySelector<HTMLElement>('[data-testid="analysis-section"]')
          if (section?.classList.contains('cs-closed')) section.querySelector<HTMLElement>('.cs-toggle')?.click()
          if (++tries < 20) window.setTimeout(find, 40)
          return
        }
        rows.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
        rows.classList.remove('cmdk-flash')
        void rows.offsetWidth
        rows.classList.add('cmdk-flash')
        if (!restrict) return
        const btn = rows.querySelector<HTMLButtonElement>('[data-testid="restrict-domain"]')
        if (!btn) return
        if (btn.disabled) {
          showToast(btn.title || 'This function’s domain can’t be restricted here.')
          return
        }
        if (!rows.querySelector('[data-testid="restrict-editor"]')) btn.click()
        window.setTimeout(() => rows.querySelector<HTMLInputElement>('[data-testid="restrict-editor"] input')?.focus(), 60)
      }
      window.setTimeout(find, 0)
    },
    [revealSidebar, showToast],
  )

  /** Import from file… without the document menu: the same file picker, the same import. */
  const pickImportFile = useCallback((): void => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.onchange = () => {
      const file = input.files?.[0]
      if (file) importDocument(file)
    }
    input.click()
  }, [importDocument])

  return {
    showBuilder, revealSidebar, typeLine, deleteSelection, showDomain, pickImportFile,
  }
}

export type SidebarEditorsApi = ReturnType<typeof useSidebarEditors>

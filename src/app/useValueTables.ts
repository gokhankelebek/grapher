// ============================================================================
// src/app/useValueTables.ts — the Table section of every explicit curve's
// card: its panel (selected card only), its edits, "Copy to a data table",
// and the tables a teacher put on the figure.
//
// The settings live in board.valueTables (one ValueTableView per curve, what
// was typed); saved with the document in board.curveViews and never an undo
// step, like the Domain section's switches. Everything shown is recomputed
// from the curve (src/ui/valueTableLinks.ts), so a table follows a slider.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useCallback, useMemo, useRef } from 'react'
import type { ValueTableView } from '../core/persist'
import { patchTableView } from '../ui/curveViews'
import type { TableActions } from '../ui/TableSection'
import type { TableContext, TablePanel, ValueTableFigure } from '../ui/valueTableLinks'
import { tableDataRows, tableFigures, tablePanel } from '../ui/valueTableLinks'
import type { BoardStateApi } from './useBoardState'
import type { DocumentStateApi } from './useDocumentState'
import type { ModelsApi } from './useModels'
import type { NoticesApi } from './useNotices'
import type { DataTablesApi } from './useDataTables'
import type { CurveNamesApi } from './useCurveNames'

/** What useValueTables reads from the hooks App calls before it. */
export interface ValueTablesDeps {
  board: BoardStateApi
  docState: DocumentStateApi
  derived: ModelsApi
  notices: NoticesApi
  tables: DataTablesApi
  naming: CurveNamesApi
}

export function useValueTables({ board, docState, derived, notices, tables, naming }: ValueTablesDeps) {
  const { curves, kind, selectedId, valueTables, setValueTables, valueTablesRef } = board
  const { names, exprSources, displaySources } = docState
  const { models, depKeys } = derived
  const { showToast } = notices
  const { addDataTableFrom } = tables
  const { cardNames } = naming

  /** Who is who, for Evaluate, compare and the headers. */
  const ctx = useMemo<TableContext>(
    () => ({
      curves,
      models,
      letters: names,
      names: cardNames,
      sources: { ...displaySources, ...exprSources },
    }),
    [curves, models, names, cardNames, displaySources, exprSources],
  )
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx

  // ---- the selected card's panel: only it is open, so only it is computed
  const panel = useMemo<TablePanel | undefined>(() => {
    if (kind !== 'cartesian' || !selectedId) return undefined
    const c = curves.find((k) => k.id === selectedId)
    if (!c || c.kind !== 'explicit') return undefined
    try {
      return tablePanel(c, valueTables[c.id], ctx) ?? undefined
    } catch {
      return undefined
    }
    // depKeys: g(x) = f(x) + 1 follows f.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, selectedId, curves, valueTables, ctx, depKeys])
  const tablePanelFor = useCallback(
    (id: string): TablePanel | undefined => (panel && panel.curveId === id ? panel : undefined),
    [panel],
  )

  /** Change one curve's stored settings (never an undo step; saved with the document). */
  const patchTable = useCallback(
    (curveId: string, patch: Partial<Record<keyof ValueTableView, unknown>>): void => {
      const next = patchTableView(valueTablesRef.current, curveId, patch)
      if (next === valueTablesRef.current) return
      valueTablesRef.current = next
      setValueTables(next)
    },
    [],
  )

  const copyToData = useCallback(
    (curveId: string): void => {
      const c = curves.find((k) => k.id === curveId)
      if (!c) return
      const p = tablePanel(c, valueTablesRef.current[curveId], ctxRef.current)
      if (!p) return
      const rows = tableDataRows(p)
      if (rows.length === 0) {
        showToast('The table has no defined rows to copy.')
        return
      }
      const name = addDataTableFrom(rows, { xLabel: 'x', yLabel: `${p.name}(x)` })
      showToast(`Copied ${rows.length} rows to ${name}.`, { ms: 2200 })
    },
    [curves, addDataTableFrom, showToast],
  )

  const tableActions = useMemo<TableActions>(() => ({ patch: patchTable, copyToData }), [patchTable, copyToData])

  // ---- the tables on the figure (screen and every export draw this list)
  const tableFigs = useMemo<ValueTableFigure[]>(() => {
    if (kind !== 'cartesian') return []
    if (!Object.values(valueTables).some((v) => v.fig)) return []
    try {
      return tableFigures(curves, valueTables, ctx)
    } catch {
      return []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, curves, valueTables, ctx, depKeys])
  const tableFigsRef = useRef(tableFigs)
  tableFigsRef.current = tableFigs

  return { tablePanelFor, tableActions, patchTable, tableFigs, tableFigsRef }
}

export type ValueTablesApi = ReturnType<typeof useValueTables>

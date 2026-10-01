// ============================================================================
// src/app/useDataTables.ts — data tables and their regressions; what tables and sequences draw.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fitRegression, regressionSource } from '../core/data'
import type { DataParse } from '../core/data'
import { parseExpression } from '../core/parse'
import { CURVE_COLORS, nextId } from '../core/types'
import type { FittedCurve, ModelSpec, ParsedPlot } from '../core/types'
import { countPhrase } from '../ui/calcLinks'
import {
  applyPaste,
  clampRegDigits,
  dataBox,
  dataCard,
  dataColumns,
  linkedCurves,
  nextTableName,
  planIsEmpty,
  planRegressionSync,
  REG_DIGITS_DEFAULT,
  removeRow as removeDataRow,
  scatterSets,
  setCell as setDataCell,
} from '../ui/dataLinks'
import type {
  BoardData,
  DataCardData,
  DataMarker,
  DataRegression,
  PasteMode,
  RegressionKind,
} from '../ui/dataLinks'
import { solveSpan, spanCovers } from '../ui/fieldLinks'
import type { Polyline, ScatterSet } from '../ui/renderBoard'
import {
  compileSequences,
  nextSequenceLetter,
  partnerPolylines,
  sequenceCard,
  sequenceLetters,
  sequenceScatter,
} from '../ui/seqLinks'
import type { CompiledSequence, SequenceCardData } from '../ui/seqLinks'
import type { StatePatch } from './types'
import type { BoardStateApi } from './useBoardState'
import type { DocumentStateApi } from './useDocumentState'
import type { BoardRefsApi } from './useBoardRefs'
import type { ModelsApi } from './useModels'
import type { NoticesApi } from './useNotices'
import type { HistoryApi } from './useHistory'
import type { CurveEditingApi } from './useCurveEditing'

/** What useDataTables reads from the hooks App calls before it. */
export interface DataTablesDeps {
  board: BoardStateApi
  docState: DocumentStateApi
  refs: BoardRefsApi
  derived: ModelsApi
  notices: NoticesApi
  history: HistoryApi
  editing: CurveEditingApi
}

export function useDataTables({ board, docState, refs, derived, notices, history, editing }: DataTablesDeps) {
  const { curves, kind, setSelectedId, setExtraModels, dataSets, sequences } = board
  const { exprSources, names } = docState
  const {
    curvesRef, undoRef, redoRef, exprCounterRef, exprSourcesRef, brokenExprRef, dataRef,
    regWrittenRef, regAutoHiddenRef, fitCacheRef, cellFoldRef, frameBoxRef,
  } = refs
  const { vpRef } = derived
  const { showToast } = notices
  const { applyState, commitState, undo } = history
  const { pickColor, removeWithDependents } = editing

  // ============================================================= data tables
  //
  // A table is the teacher's text — every cell as typed or pasted — plus the
  // regressions fitted to it as LINKS: {kind, curveId, digits}. Each
  // regression's curve is an ordinary TYPED curve whose source is the fitted
  // equation, so its card gets the Exponential / Logarithmic sections, the
  // analysis and the calculus for free. Whenever the table changes, every
  // linked regression is re-fitted and its curve restated IN PLACE (same id,
  // colour, style and name), exactly as a tangent follows its parent — see
  // src/ui/dataLinks.ts for the rules, including when a hand-edited curve
  // lets go of its table.

  /** One table, replaced in place. */
  const mapData = useCallback(
    (id: string, fn: (d: BoardData) => BoardData): BoardData[] =>
      dataRef.current.map((d) => (d.id === id ? fn(d) : d)),
    [],
  )

  /**
   * One undo entry per CELL edit, however many keystrokes: the first
   * keystroke commits, the rest fold into that entry while nothing else has
   * been done since. Every keystroke still re-fits live.
   */
  const foldCommit = useCallback(
    (key: string, patch: StatePatch, label: string): void => {
      const top = undoRef.current[undoRef.current.length - 1]
      const fold = cellFoldRef.current
      if (fold && fold.key === key && top !== undefined && top === fold.snap) {
        redoRef.current = []
        applyState(patch)
        return
      }
      commitState(patch, label)
      cellFoldRef.current = { key, snap: undoRef.current[undoRef.current.length - 1] }
    },
    [applyState, commitState],
  )

  /** A parsed equation as a curve's model, registered under a fresh expr_N. */
  const typedModel = useCallback(
    (src: string): { modelId: string; spec: ModelSpec; plot: ParsedPlot } | null => {
      let outcome: ReturnType<typeof parseExpression>
      try {
        outcome = parseExpression(src)
      } catch {
        return null
      }
      if (!outcome.ok) return null
      const modelId = `expr_${++exprCounterRef.current}`
      try {
        return { modelId, spec: outcome.plot.makeModel(modelId), plot: outcome.plot }
      } catch {
        return null
      }
    },
    [],
  )

  /** "Build ▾ → Data table": an empty table, selected, ready to type or paste into. */
  const addDataTable = useCallback((): void => {
    const table: BoardData = {
      id: nextId(),
      name: nextTableName(dataRef.current),
      xLabel: 'x',
      yLabel: 'y',
      rows: [],
      color: pickColor(),
      visible: true,
      regressions: [],
    }
    commitState({ data: [...dataRef.current, table] }, 'add data table')
    setSelectedId(table.id)
  }, [commitState, pickColor])

  const setDataCellText = useCallback(
    (id: string, row: number, col: 'x' | 'y', text: string): void => {
      const d = dataRef.current.find((t) => t.id === id)
      if (!d) return
      const before = d.rows[row]?.[col] ?? ''
      if (before === text) return
      foldCommit(
        `${id}:${row}:${col}`,
        { data: mapData(id, (t) => ({ ...t, rows: setDataCell(t.rows, row, col, text) })) },
        'edit table cell',
      )
    },
    [foldCommit, mapData],
  )

  const setDataLabel = useCallback(
    (id: string, col: 'x' | 'y', text: string): void => {
      const d = dataRef.current.find((t) => t.id === id)
      if (!d) return
      const key = col === 'x' ? 'xLabel' : 'yLabel'
      if (d[key] === text) return
      foldCommit(`${id}:label:${col}`, { data: mapData(id, (t) => ({ ...t, [key]: text })) }, 'rename column')
    },
    [foldCommit, mapData],
  )

  const removeDataRowAt = useCallback(
    (id: string, row: number): void => {
      const d = dataRef.current.find((t) => t.id === id)
      if (!d || row < 0 || row >= d.rows.length) return
      commitState({ data: mapData(id, (t) => ({ ...t, rows: removeDataRow(t.rows, row) })) }, 'remove row')
    },
    [commitState, mapData],
  )

  const pasteData = useCallback(
    (id: string, parse: DataParse, mode: PasteMode): void => {
      const d = dataRef.current.find((t) => t.id === id)
      if (!d || !parse.ok) return
      const wasEmpty = dataColumns(d.rows).xs.length === 0
      const next = applyPaste(d, parse, mode)
      commitState(
        { data: mapData(id, (t) => ({ ...t, ...next })) },
        mode === 'append' ? 'append pasted data' : 'paste data',
      )
      // The first data a table gets is framed: pasted years and populations
      // would otherwise land far off a board sitting on −8 … 8.
      if (wasEmpty) {
        const box = dataBox({ ...d, ...next })
        if (box) frameBoxRef.current(box)
      }
    },
    [commitState, mapData],
  )

  const toggleDataVisible = useCallback(
    (id: string): void => {
      const d = dataRef.current.find((t) => t.id === id)
      if (!d) return
      commitState(
        { data: mapData(id, (t) => ({ ...t, visible: !t.visible })) },
        d.visible ? 'hide data' : 'show data',
      )
    },
    [commitState, mapData],
  )

  /**
   * Recolour a table. Its linked regression curves that still wear the
   * table's colour change with it, in the same commit — a curve the teacher
   * recoloured to tell two fits apart keeps the colour they gave it.
   */
  const cycleDataColor = useCallback(
    (id: string): void => {
      const d = dataRef.current.find((t) => t.id === id)
      if (!d) return
      const i = CURVE_COLORS.indexOf(d.color)
      const next = CURVE_COLORS[(i + 1) % CURVE_COLORS.length]
      const follow = new Set(linkedCurves(d))
      commitState(
        {
          data: mapData(id, (t) => ({ ...t, color: next })),
          curves: curvesRef.current.map((c) =>
            follow.has(c.id) && c.color === d.color ? { ...c, color: next } : c,
          ),
        },
        'change colour',
      )
    },
    [commitState, mapData],
  )

  const setDataMarker = useCallback(
    (id: string, marker: DataMarker): void => {
      const d = dataRef.current.find((t) => t.id === id)
      if (!d || (d.marker ?? 'dot') === marker) return
      commitState(
        {
          data: mapData(id, (t) => {
            const { marker: _was, ...rest } = t
            return marker === 'dot' ? rest : { ...rest, marker }
          }),
        },
        'point markers',
      )
    },
    [commitState, mapData],
  )

  /**
   * Take a table off the board, with every regression curve that follows it —
   * one commit, one toast, one undo. A DETACHED regression's curve stays: it
   * stopped being the table's the moment its equation was edited by hand.
   */
  const deleteData = useCallback(
    (id: string): void => {
      const d = dataRef.current.find((t) => t.id === id)
      if (!d) return
      const onBoard = new Set(curvesRef.current.map((c) => c.id))
      const linked = linkedCurves(d).filter((cid) => onBoard.has(cid))
      const rest = dataRef.current.filter((t) => t.id !== id)
      if (linked.length === 0) {
        commitState({ data: rest }, 'delete data table')
        showToast('Deleted the table. Undo brings it back.', {
          action: { label: 'Undo', run: () => undo() },
        })
      } else {
        removeWithDependents(linked, 'delete data table', rest)
        showToast(
          `Deleted the table and its ${countPhrase(linked.length, 'regression curve')}. Undo brings all of it back.`,
          { ms: 5000, action: { label: 'Undo', run: () => undo() } },
        )
      }
      setSelectedId((sel) => (sel === id ? null : sel))
    },
    [commitState, removeWithDependents, showToast, undo],
  )

  /** The rows again, as a new table. Its regressions are not copied: a fit is one click. */
  const duplicateData = useCallback(
    (id: string): void => {
      const d = dataRef.current.find((t) => t.id === id)
      if (!d) return
      const copy: BoardData = {
        ...d,
        id: nextId(),
        name: nextTableName(dataRef.current),
        rows: d.rows.map((r) => ({ ...r })),
        color: pickColor(),
        regressions: [],
      }
      commitState({ data: [...dataRef.current, copy] }, 'duplicate table')
      setSelectedId(copy.id)
    },
    [commitState, pickColor],
  )

  /**
   * Fit `kind` and put its curve on the board, LINKED: a typed curve in the
   * table's colour whose equation is regressionSource(fit, digits). Refuses
   * with the fitter's own sentence.
   */
  const addRegression = useCallback(
    (id: string, kind: RegressionKind): string | null => {
      const d = dataRef.current.find((t) => t.id === id)
      if (!d) return null
      if (d.regressions.some((r) => r.kind === kind && !r.detached)) {
        return 'That regression is already on the board.'
      }
      const cols = dataColumns(d.rows)
      const res = fitRegression(kind, cols.xs, cols.ys)
      if (!res.ok) return res.error ?? 'This model cannot be fitted to the data.'
      const src = regressionSource(res, REG_DIGITS_DEFAULT)
      const built = src ? typedModel(src) : null
      if (!built) return 'The fitted equation could not be drawn.'
      setExtraModels((prev) => ({ ...prev, [built.modelId]: built.spec }))
      const curve: FittedCurve = {
        id: nextId(),
        modelId: built.modelId,
        params: built.plot.defaultParams.slice(),
        kind: built.plot.kind,
        domain: built.plot.domain,
        color: d.color,
        strokeWidth: 2,
        visible: true,
        error: 0,
      }
      const reg: DataRegression = {
        id: nextId(),
        kind,
        curveId: curve.id,
        digits: REG_DIGITS_DEFAULT,
        residuals: false,
      }
      regWrittenRef.current.set(reg.id, src)
      commitState(
        {
          curves: [...curvesRef.current, curve],
          exprSources: { ...exprSourcesRef.current, [curve.id]: src },
          data: mapData(id, (t) => ({ ...t, regressions: [...t.regressions, reg] })),
        },
        `${kind} regression`,
      )
      return null
    },
    [commitState, mapData, typedModel],
  )

  /**
   * × on a regression. A linked one takes its curve (and anything built on
   * that curve) with it; a detached one only lets go — its curve is an
   * ordinary curve now, with a card and a × of its own.
   */
  const removeRegression = useCallback(
    (id: string, regId: string): void => {
      const d = dataRef.current.find((t) => t.id === id)
      const reg = d?.regressions.find((r) => r.id === regId)
      if (!d || !reg) return
      const onBoard = curvesRef.current.some((c) => c.id === reg.curveId)
      if (reg.detached || !onBoard) {
        commitState(
          { data: mapData(id, (t) => ({ ...t, regressions: t.regressions.filter((r) => r.id !== regId) })) },
          'forget regression',
        )
        return
      }
      removeWithDependents([reg.curveId], 'remove regression')
    },
    [commitState, mapData, removeWithDependents],
  )

  const mapRegression = useCallback(
    (id: string, regId: string, fn: (r: DataRegression) => DataRegression): BoardData[] =>
      mapData(id, (t) => ({ ...t, regressions: t.regressions.map((r) => (r.id === regId ? fn(r) : r)) })),
    [mapData],
  )

  const setRegressionDigits = useCallback(
    (id: string, regId: string, digits: number): void => {
      const d = dataRef.current.find((t) => t.id === id)
      const reg = d?.regressions.find((r) => r.id === regId)
      const next = clampRegDigits(digits)
      if (!reg || reg.digits === next) return
      commitState({ data: mapRegression(id, regId, (r) => ({ ...r, digits: next })) }, `${next} digits`)
    },
    [commitState, mapRegression],
  )

  /** Residuals to this fit — one set per table, so turning one on turns the others off. */
  const toggleResiduals = useCallback(
    (id: string, regId: string): void => {
      const d = dataRef.current.find((t) => t.id === id)
      const reg = d?.regressions.find((r) => r.id === regId)
      if (!reg) return
      const on = !reg.residuals
      commitState(
        {
          data: mapData(id, (t) => ({
            ...t,
            regressions: t.regressions.map((r) =>
              r.id === regId ? { ...r, residuals: on } : r.residuals && on ? { ...r, residuals: false } : r,
            ),
          })),
        },
        on ? 'show residuals' : 'hide residuals',
      )
    },
    [commitState, mapData],
  )

  /** Re-attach a detached regression: the next sync writes the fit over the hand edit. */
  const refitRegression = useCallback(
    (id: string, regId: string): void => {
      const d = dataRef.current.find((t) => t.id === id)
      const reg = d?.regressions.find((r) => r.id === regId)
      if (!d || !reg || !reg.detached) return
      if (!curvesRef.current.some((c) => c.id === reg.curveId)) return
      // Another linked fit of the same kind would be the same curve twice.
      if (d.regressions.some((r) => r.id !== regId && r.kind === reg.kind && !r.detached)) {
        showToast(`This table already has a linked ${reg.kind} regression.`, { ms: 3000 })
        return
      }
      regWrittenRef.current.delete(regId)
      commitState(
        {
          data: mapRegression(id, regId, (r) => {
            const { detached: _d, ...rest } = r
            return rest
          }),
        },
        'follow the table again',
      )
    },
    [commitState, mapRegression, showToast],
  )

  /**
   * Re-fit every linked regression and restate its curve in place.
   *
   * Runs after any change to the tables, the curves or their equations, and
   * does nothing unless a fit actually says something new. Like the calculus
   * sync it never pushes history: a curve re-fitting is the consequence of
   * the edit that changed the table, and rides inside that edit's undo entry.
   */
  const syncRegressions = useCallback((): void => {
    const tables = dataRef.current
    if (tables.length === 0) {
      if (regWrittenRef.current.size > 0) regWrittenRef.current = new Map()
      if (regAutoHiddenRef.current.size > 0) regAutoHiddenRef.current = new Set()
      return
    }
    const plan = planRegressionSync({
      data: tables,
      curves: curvesRef.current,
      exprSources: exprSourcesRef.current,
      written: regWrittenRef.current,
      autoHidden: regAutoHiddenRef.current,
      fit: fitCacheRef.current,
    })
    regWrittenRef.current = plan.written
    regAutoHiddenRef.current = plan.autoHidden
    if (planIsEmpty(plan)) return

    const patch: StatePatch = {}
    const register: Record<string, ModelSpec> = {}
    const curvePatch = new Map<string, Partial<FittedCurve>>()
    let exprSources = exprSourcesRef.current
    let brokenExpr = brokenExprRef.current
    for (const r of plan.restate) {
      const built = typedModel(r.src)
      if (!built) continue
      register[built.modelId] = built.spec
      curvePatch.set(r.curveId, {
        modelId: built.modelId,
        kind: built.plot.kind,
        params: built.plot.defaultParams.slice(),
        domain: built.plot.domain,
        error: 0,
      })
      exprSources = { ...exprSources, [r.curveId]: r.src }
      if (brokenExpr[r.curveId] !== undefined) {
        const { [r.curveId]: _gone, ...rest } = brokenExpr
        brokenExpr = rest
      }
    }
    for (const h of plan.hide) curvePatch.set(h.curveId, { ...curvePatch.get(h.curveId), visible: false })
    for (const h of plan.show) curvePatch.set(h.curveId, { ...curvePatch.get(h.curveId), visible: true })
    if (curvePatch.size > 0) {
      patch.curves = curvesRef.current.map((c) => {
        const p = curvePatch.get(c.id)
        if (!p) return c
        const { sourceStroke: _ink, ...bare } = c
        return { ...bare, ...p }
      })
    }
    if (exprSources !== exprSourcesRef.current) patch.exprSources = exprSources
    if (brokenExpr !== brokenExprRef.current) patch.brokenExpr = brokenExpr
    if (plan.detach.length > 0) {
      const gone = new Set(plan.detach.map((x) => x.regId))
      patch.data = tables.map((t) =>
        t.regressions.some((r) => gone.has(r.id))
          ? {
              ...t,
              regressions: t.regressions.map((r) =>
                gone.has(r.id) ? { ...r, detached: true, residuals: false } : r,
              ),
            }
          : t,
      )
    }
    if (Object.keys(register).length > 0) setExtraModels((prev) => ({ ...prev, ...register }))
    applyState(patch)
  }, [applyState, typedModel])

  useEffect(() => {
    syncRegressions()
  }, [curves, dataSets, exprSources, syncRegressions])

  // ------------------------------------------------------- what the tables draw
  const curveIdSet = useMemo(() => new Set(curves.map((c) => c.id)), [curves])

  /** Every sequence, worked out once per change: terms, sums, class, partner. */
  const seqCompiled = useMemo<Map<string, CompiledSequence>>(() => compileSequences(sequences), [sequences])
  const seqCompiledRef = useRef(seqCompiled)
  seqCompiledRef.current = seqCompiled

  // The tables' points, then every sequence's dots (n, aₙ) and — when its
  // card says so — its partial sums (n, Sₙ) as rings. One field for both, on
  // screen and in the export (BoardScene.scatter).
  const scatterScene = useMemo<ScatterSet[]>(() => {
    if (kind !== 'cartesian') return []
    const tables = scatterSets(dataSets, curveIdSet)
    if (sequences.length === 0) return tables
    return [...tables, ...sequenceScatter(sequences, seqCompiled)]
  }, [kind, dataSets, curveIdSet, sequences, seqCompiled])
  const scatterSceneRef = useRef<ScatterSet[]>(scatterScene)
  scatterSceneRef.current = scatterScene

  const dataCards = useMemo<Record<string, DataCardData>>(() => {
    const out: Record<string, DataCardData> = {}
    for (const d of dataSets) out[d.id] = dataCard(d, exprSources, curveIdSet, fitCacheRef.current)
    return out
  }, [dataSets, exprSources, curveIdSet])

  const dataCardFor = useCallback(
    (id: string): DataCardData | undefined => dataCards[id],
    [dataCards],
  )

  const seqCards = useMemo<Record<string, SequenceCardData>>(() => {
    const out: Record<string, SequenceCardData> = {}
    for (const q of sequences) {
      const c = seqCompiled.get(q.id)
      if (c) out[q.id] = sequenceCard(q, c)
    }
    return out
  }, [sequences, seqCompiled])

  const seqCardFor = useCallback(
    (id: string): SequenceCardData | undefined => seqCards[id],
    [seqCards],
  )

  /** The letter "Build ▾ → Sequence" offers: the first one nothing holds. */
  const seqDefaultName = useMemo(
    () => nextSequenceLetter([...Object.values(names), ...sequenceLetters(sequences)]),
    [names, sequences],
  )

  /**
   * Where a sequence's dashed partner is sampled: the window, padded, grown
   * only when the view leaves it — the solved-span rule the slope fields use,
   * so a pan inside the margin costs two comparisons and no render.
   */
  const [partnerSpan, setPartnerSpan] = useState<[number, number]>(() => [-10, 10])
  const partnerSpanRef = useRef<[number, number]>(partnerSpan)
  partnerSpanRef.current = partnerSpan
  const hasPartnerRef = useRef(false)
  hasPartnerRef.current = sequences.some((q) => q.visible && q.showPartner)
  const refreshPartnerSpan = useCallback((): void => {
    if (!hasPartnerRef.current) return
    const vp = vpRef.current
    const half = vp.widthPx / 2 / vp.pxPerUnit
    const window: [number, number] = [vp.center.x - half, vp.center.x + half]
    if (spanCovers(partnerSpanRef.current, window)) return
    const next = solveSpan(window)
    partnerSpanRef.current = next
    setPartnerSpan(next)
  }, [])
  useEffect(() => {
    refreshPartnerSpan()
  }, [sequences, refreshPartnerSpan])

  /** The dashed partners on screen: figure content, like a solution curve. */
  const partnerLines = useMemo<Polyline[]>(
    () => (kind === 'cartesian' ? partnerPolylines(sequences, seqCompiled, partnerSpan) : []),
    [kind, sequences, seqCompiled, partnerSpan],
  )

  return {
    addDataTable, setDataCellText, setDataLabel, removeDataRowAt, pasteData, toggleDataVisible,
    cycleDataColor, setDataMarker, deleteData, duplicateData, addRegression, removeRegression,
    setRegressionDigits, toggleResiduals, refitRegression, seqCompiled, seqCompiledRef,
    scatterScene, scatterSceneRef, dataCardFor, seqCardFor, seqDefaultName, refreshPartnerSpan,
    partnerLines,
  }
}

export type DataTablesApi = ReturnType<typeof useDataTables>

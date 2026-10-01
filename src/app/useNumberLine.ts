// ============================================================================
// src/app/useNumberLine.ts — number-line items: points, intervals and solved inequalities.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useCallback, useRef } from 'react'
import { parseInequality } from '../core/parse/inequality'
import type { SolveResult } from '../core/solveInequality'
import { CURVE_COLORS, nextId, NL_SOLVE_DEFAULTS } from '../core/types'
import type { NLItem, NLItemDraft, NLSolveItem, NLSolveShow } from '../core/types'
import type { NLPart } from '../render/numberline'
import { solveCached, solveErrorText } from '../ui/nlSolve'
import { answerPieces } from '../ui/nlText'
import type { BoardStateApi } from './useBoardState'
import type { BoardRefsApi } from './useBoardRefs'
import type { HistoryApi } from './useHistory'
import type { CurveEditingApi } from './useCurveEditing'

/** What useNumberLine reads from the hooks App calls before it. */
export interface NumberLineDeps {
  board: BoardStateApi
  refs: BoardRefsApi
  history: HistoryApi
  editing: CurveEditingApi
}

export function useNumberLine({ board, refs, history, editing }: NumberLineDeps) {
  const { setSelectedId } = board
  const { itemsRef, stylesRef } = refs
  const { applyState, commitState } = history
  const { pickColor } = editing

  // ======================================================= number-line items
  //
  // The whole content of this figure is where each endpoint sits and whether it
  // is IN or OUT, so every one of these operations is one of those two facts —
  // and each is a single undoable commit, because each is a single statement a
  // teacher made.

  /** Replace one item, keeping order. */
  const mapItems = useCallback(
    (id: string, fn: (it: NLItem) => NLItem): NLItem[] =>
      itemsRef.current.map((it) => (it.id === id ? fn(it) : it)),
    [],
  )

  /**
   * Add parsed items — one colour, and one GROUP, for the whole answer.
   *
   * "x < −2 or x ≥ 3" is one answer in two pieces. The label used to be given
   * to the first piece only, which put the caption over the left ray and left
   * the right ray with nothing: the label was a property of a piece when it is
   * a property of the answer. It is now stamped on every piece, so it appears
   * over each one rather than being orphaned on whichever came first, and the
   * pieces carry a shared group stamp so the card can still edit and copy the
   * answer as a whole.
   */
  const addItems = useCallback(
    (drafts: NLItemDraft[], label?: string): NLItem[] => {
      if (drafts.length === 0) return []
      const color = pickColor()
      const group = drafts.length > 1 ? nextId() : null
      const made: NLItem[] = drafts.map((d) => ({
        ...d,
        id: nextId(),
        color,
        ...(label ? { label } : {}),
      })) as NLItem[]
      const styles = group === null ? stylesRef.current : { ...stylesRef.current }
      if (group !== null) {
        for (const it of made) styles[it.id] = { ...styles[it.id], group }
      }
      commitState({ items: [...itemsRef.current, ...made], styles })
      setSelectedId(made[0].id)
      return made
    },
    [commitState, pickColor],
  )

  /** Click on the line. A placed point is closed: the value IS in the set. */
  const placePoint = useCallback(
    (x: number): void => {
      addItems([{ kind: 'point', x, closed: true }])
    },
    [addItems],
  )

  const createInterval = useCallback(
    (lo: number, hi: number): void => {
      addItems([{ kind: 'interval', lo, hi, loClosed: true, hiClosed: true }])
    },
    [addItems],
  )

  /** Live endpoint drag. Ends may not cross — they swap roles instead. */
  const moveEndpoint = useCallback(
    (id: string, part: NLPart, x: number): void => {
      applyState({
        items: mapItems(id, (it) => {
          if (it.kind === 'solve') return it
          if (it.kind === 'point') return { ...it, x }
          if (part === 'lo') return { ...it, lo: it.hi !== null ? Math.min(x, it.hi) : x }
          if (part === 'hi') return { ...it, hi: it.lo !== null ? Math.max(x, it.lo) : x }
          return it
        }),
      })
    },
    [applyState, mapItems],
  )

  /** The one edit this figure exists for: included <-> excluded. */
  const toggleEnd = useCallback(
    (id: string, part: NLPart): void => {
      commitState({
        items: mapItems(id, (it) => {
          if (it.kind === 'solve') return it
          if (it.kind === 'point') return { ...it, closed: !it.closed }
          if (part === 'lo') return { ...it, loClosed: !it.loClosed }
          if (part === 'hi') return { ...it, hiClosed: !it.hiClosed }
          return it
        }),
      })
      setSelectedId(id)
    },
    [commitState, mapItems],
  )

  /** Type an exact endpoint; null means unbounded (drawn as an arrow). */
  const setBound = useCallback(
    (id: string, part: NLPart, value: number | null): void => {
      commitState({
        items: mapItems(id, (it) => {
          if (it.kind === 'solve') return it
          if (it.kind === 'point') return value === null ? it : { ...it, x: value }
          if (part === 'lo') {
            // Refusing (-inf, inf) here rather than repairing it later: a set
            // with no ends at all is not something this figure can say.
            if (value === null && it.hi === null) return it
            return { ...it, lo: value === null || it.hi === null ? value : Math.min(value, it.hi) }
          }
          if (part === 'hi') {
            if (value === null && it.lo === null) return it
            return { ...it, hi: value === null || it.lo === null ? value : Math.max(value, it.lo) }
          }
          return it
        }),
      })
    },
    [commitState, mapItems],
  )

  /**
   * Label an answer. Every piece of it takes the label, because a caption that
   * says "solution" belongs over the whole solution set and not over whichever
   * ray happened to be parsed first.
   */
  const setItemLabel = useCallback(
    (id: string, label: string): void => {
      const text = label.trim().slice(0, 60)
      const pieces = new Set(
        answerPieces(itemsRef.current, stylesRef.current, id).map((it) => it.id),
      )
      commitState({
        items: itemsRef.current.map((it) => {
          if (!pieces.has(it.id)) return it
          const { label: _old, ...rest } = it
          return (text ? { ...rest, label: text } : rest) as NLItem
        }),
      })
    },
    [commitState],
  )

  const cycleItemColor = useCallback(
    (id: string): void => {
      commitState({
        items: mapItems(id, (it) => {
          const idx = CURVE_COLORS.indexOf(it.color)
          return { ...it, color: CURVE_COLORS[(idx + 1 + CURVE_COLORS.length) % CURVE_COLORS.length] }
        }),
      })
    },
    [commitState, mapItems],
  )

  const deleteItem = useCallback(
    (id: string): void => {
      const { [id]: _gone, ...restStyles } = stylesRef.current
      commitState({ items: itemsRef.current.filter((it) => it.id !== id), styles: restStyles })
      setSelectedId((sel) => (sel === id ? null : sel))
    },
    [commitState],
  )

  const setItemWidth = useCallback(
    (id: string, width: number): void => {
      applyState({ styles: { ...stylesRef.current, [id]: { ...stylesRef.current[id], width } } })
    },
    [applyState],
  )

  /**
   * Type an inequality. The parser owns what the language accepts and hands
   * back items already sorted and merged, so "x < 1 or x < 3" arrives as one
   * ray rather than two stacked on top of each other.
   */
  /**
   * Type an inequality: it is SOLVED (src/core/solveInequality.ts) and lands
   * as one solve item — its set on the line, its working on its card. Only
   * what the solver does not read (interval notation "[-2, 5)", a point set
   * "{-1, 2}") goes to the old parser and becomes plain draggable items, as
   * before. When neither reads it, the solver's complaint is the one shown,
   * with its position.
   */
  const addInequality = useCallback(
    (src: string): string | null => {
      const line = src.trim()
      const solved = solveCached(line)
      if (solved.ok) {
        const item: NLSolveItem = {
          kind: 'solve',
          id: nextId(),
          src: line,
          color: pickColor(),
          // A chain (−1 ≤ x < 3) is an "and" the teacher did not write out:
          // it shows as one set; typed "and" / "or" shows its clauses stacked.
          show: { ...NL_SOLVE_DEFAULTS, stacked: /\b(and|or)\b/i.test(line) },
        }
        commitState({ items: [...itemsRef.current, item] }, 'solve inequality')
        setSelectedId(item.id)
        frameSolveRef.current(solved)
        return null
      }
      let outcome: ReturnType<typeof parseInequality> | null = null
      try {
        outcome = parseInequality(src)
      } catch {
        outcome = null
      }
      if (outcome && outcome.ok && Array.isArray(outcome.items) && outcome.items.length > 0) {
        addItems(outcome.items)
        return null
      }
      if (solved.error === 'not implemented') {
        if (!outcome) return 'That couldn’t be read as an inequality'
        return outcome.ok ? 'That describes no numbers at all' : outcome.error
      }
      return solveErrorText(line, solved)
    },
    [addItems, commitState, pickColor],
  )

  /** Where the board frames a newly solved line (set once frameBox exists, below). */
  const frameSolveRef = useRef<(r: SolveResult) => void>(() => {})

  /** A solved inequality's display flags: one undoable statement each. */
  const setSolveShow = useCallback(
    (id: string, patch: NLSolveShow): void => {
      commitState(
        {
          items: mapItems(id, (it) => (it.kind === 'solve' ? { ...it, show: { ...it.show, ...patch } } : it)),
        },
        'solve display',
      )
    },
    [commitState, mapItems],
  )

  /**
   * Restate ONE item from its own card. The parser owns what the language
   * accepts, so this is the same language the "+" box takes — and an answer
   * that is a union ("x < -2 or x >= 3") replaces the item with its parts,
   * in place, keeping the colour and the label the teacher gave it.
   */
  const setItemEquation = useCallback(
    (id: string, src: string): string | null => {
      const at = itemsRef.current.findIndex((it) => it.id === id)
      if (at < 0) return null
      const old = itemsRef.current[at]
      const line = src.trim()
      // A solved line is retyped in place: same id, colour, label and flags.
      // A plain item retyped as something only the solver reads becomes one.
      const asSolve = (): string | null => {
        const solved = solveCached(line)
        if (!solved.ok) return solveErrorText(line, solved)
        const next: NLSolveItem =
          old.kind === 'solve'
            ? { ...old, src: line }
            : {
                kind: 'solve',
                id: old.id,
                src: line,
                color: old.color,
                ...(old.label ? { label: old.label } : {}),
                show: { ...NL_SOLVE_DEFAULTS },
              }
        let styles = stylesRef.current
        if (old.kind !== 'solve' && styles[old.id]?.group !== undefined) {
          const { group: _g, ...rest } = styles[old.id]
          styles = { ...styles, [old.id]: rest }
        }
        commitState({ items: itemsRef.current.map((it) => (it.id === id ? next : it)), styles }, 'solve inequality')
        setSelectedId(id)
        frameSolveRef.current(solved)
        return null
      }
      if (old.kind === 'solve') return asSolve()
      let outcome: ReturnType<typeof parseInequality>
      try {
        outcome = parseInequality(src)
      } catch {
        return asSolve() === null ? null : 'That couldn’t be read as an inequality'
      }
      if (!outcome.ok) {
        const solvedErr = solveCached(line)
        if (solvedErr.ok) return asSolve()
        return outcome.error
      }
      if (!Array.isArray(outcome.items) || outcome.items.length === 0) {
        return 'That describes no numbers at all'
      }
      // The first part keeps this item's id, so the selection and the style
      // stay attached to the thing that was being edited. The label goes on
      // every part: it describes the answer, not one of its rays.
      const made: NLItem[] = outcome.items.map((d, i) => ({
        ...d,
        id: i === 0 ? old.id : nextId(),
        color: old.color,
        ...(old.label ? { label: old.label } : {}),
      })) as NLItem[]
      const group = made.length > 1 ? (stylesRef.current[old.id]?.group ?? nextId()) : null
      const styles = { ...stylesRef.current }
      if (group !== null) {
        for (const it of made) styles[it.id] = { ...styles[it.id], group }
      } else if (styles[old.id]?.group !== undefined) {
        const { group: _gone, ...rest } = styles[old.id]
        styles[old.id] = rest
      }
      commitState({
        items: [...itemsRef.current.slice(0, at), ...made, ...itemsRef.current.slice(at + 1)],
        styles,
      })
      setSelectedId(made[0].id)
      return null
    },
    [commitState],
  )

  return {
    placePoint, createInterval, moveEndpoint, toggleEnd, setBound, setItemLabel, cycleItemColor,
    deleteItem, setItemWidth, addInequality, frameSolveRef, setSolveShow, setItemEquation,
  }
}

export type NumberLineApi = ReturnType<typeof useNumberLine>

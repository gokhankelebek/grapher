// ============================================================================
// src/app/useHistory.ts — undo / redo: snapshots, commitState, the live-edit bracket.
//
// takeSnapshot / applyState / commitState, undo and redo, editStart / editEnd /
// editCancel, a curve's provenance (withEdit, noteEdit) and the Alt tracker.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useCallback, useEffect, useRef } from 'react'
import { snapParams } from '../core/fit/edit'
import { collectCurveViews, pruneViewStates, restoreViewStates } from '../ui/curveViews'
import { ensureCalls, ensureNames, sliderLetters } from '../ui/nameLinks'
import { sequenceLetters } from '../ui/seqLinks'
import { HISTORY_LIMIT } from './constants'
import type { CurveEdit, Snapshot, StatePatch } from './types'
import type { BoardStateApi } from './useBoardState'
import type { DocumentStateApi } from './useDocumentState'
import type { SessionStateApi } from './useSessionState'
import type { BoardRefsApi } from './useBoardRefs'
import type { ModelsApi } from './useModels'
import type { NoticesApi } from './useNotices'

/** What useHistory reads from the hooks App calls before it. */
export interface HistoryDeps {
  board: BoardStateApi
  docState: DocumentStateApi
  session: SessionStateApi
  refs: BoardRefsApi
  derived: ModelsApi
  notices: NoticesApi
}

export function useHistory({ board, docState, session, refs, derived, notices }: HistoryDeps) {
  const {
    setCurves, setKind, setItems, setStyles, setSelectedId, readViewStates, writeViewStates,
    setCalcLinks, setFields, setShapes, setDataSets, setSequences, setUnitCircles, setRelatedRates,
    setRrPlay, rrPlayRef, setStats, setStatsPlay, statsPlayRef, setIneqSystem, setUcPlay, ucPlayRef, setPlayEpoch, setFigureStyle,
    setFigureCaption, setSnapFlash, bumpHistory,
  } = board
  const {
    setExprSources, setBrokenExpr, setDisplaySources, setEdits, setNames, setCalls, setInverses,
  } = docState
  const { setFeatureNote, featureNoteTimerRef } = session
  const {
    curvesRef, itemsRef, kindRef, stylesRef, undoRef, redoRef, preEditRef, setGesturing,
    candidatesRef, altRef, snapTimerRef, exprSourcesRef, brokenExprRef, displaySourcesRef, editsRef,
    calcRef, fieldsRef, shapesRef, dataRef, seqRef, ucRef, rrRef, statsRef, sysRef, namesRef,
    callsRef, inversesRef, figureStyleRef, figureCaptionRef,
  } = refs
  const { modelsRef } = derived
  const { showToast } = notices

  // ------------------------------------------------------------ state/history
  const takeSnapshot = useCallback(
    (label: string): Snapshot => ({
      curves: curvesRef.current,
      items: itemsRef.current,
      kind: kindRef.current,
      styles: stylesRef.current,
      exprSources: exprSourcesRef.current,
      brokenExpr: brokenExprRef.current,
      displaySources: displaySourcesRef.current,
      edits: editsRef.current,
      calc: calcRef.current,
      fields: fieldsRef.current,
      shapes: shapesRef.current,
      data: dataRef.current,
      sequences: seqRef.current,
      unitCircles: ucRef.current,
      relatedRates: rrRef.current,
      stats: statsRef.current,
      system: sysRef.current,
      names: namesRef.current,
      calls: callsRef.current,
      inverses: inversesRef.current,
      figure: figureStyleRef.current,
      caption: figureCaptionRef.current,
      views: collectCurveViews(readViewStates()),
      candidates: candidatesRef.current,
      label,
    }),
    [readViewStates],
  )

  const applyState = useCallback((s: StatePatch): void => {
    if (s.curves) {
      const before = curvesRef.current
      curvesRef.current = s.curves
      setCurves(s.curves)
      // A curve that leaves takes its view settings with it; one that comes
      // back through undo / redo gets back the ones its snapshot recorded.
      if (before !== s.curves) {
        const cur = readViewStates()
        const next = s.views
          ? restoreViewStates(cur, s.views, new Set(before.map((c) => c.id)), s.curves)
          : pruneViewStates(cur, new Set(s.curves.map((c) => c.id)))
        if (next !== cur) writeViewStates(next)
      }
    }
    if (s.items) {
      itemsRef.current = s.items
      setItems(s.items)
    }
    if (s.kind) {
      kindRef.current = s.kind
      setKind(s.kind)
    }
    if (s.styles) {
      stylesRef.current = s.styles
      setStyles(s.styles)
    }
    if (s.exprSources) {
      exprSourcesRef.current = s.exprSources
      setExprSources(s.exprSources)
    }
    if (s.brokenExpr) {
      brokenExprRef.current = s.brokenExpr
      setBrokenExpr(s.brokenExpr)
    }
    if (s.displaySources) {
      displaySourcesRef.current = s.displaySources
      setDisplaySources(s.displaySources)
    }
    if (s.edits) {
      editsRef.current = s.edits
      setEdits(s.edits)
    }
    if (s.calc) {
      calcRef.current = s.calc
      setCalcLinks(s.calc)
    }
    if (s.fields) {
      fieldsRef.current = s.fields
      setFields(s.fields)
    }
    if (s.shapes) {
      shapesRef.current = s.shapes
      setShapes(s.shapes)
    }
    if (s.data) {
      dataRef.current = s.data
      setDataSets(s.data)
    }
    if (s.sequences) {
      seqRef.current = s.sequences
      setSequences(s.sequences)
    }
    if (s.unitCircles) {
      ucRef.current = s.unitCircles
      setUnitCircles(s.unitCircles)
    }
    if (s.relatedRates) {
      rrRef.current = s.relatedRates
      setRelatedRates(s.relatedRates)
    }
    if (s.stats) {
      statsRef.current = s.stats
      setStats(s.stats)
    }
    if (s.system !== undefined) {
      sysRef.current = s.system
      setIneqSystem(s.system)
    }
    if (s.inverses) {
      inversesRef.current = s.inverses
      setInverses(s.inverses)
    }
    // Names and calls follow the curves: a curve that arrives gets a letter,
    // one that leaves gives its letter up, and a line that leaves stops
    // calling anything. Asked on every change that can move them — and a
    // no-op (the same objects back) on a slider frame.
    if (s.names || s.calls || s.curves || s.exprSources || s.displaySources || s.calc || s.inverses) {
      const nextCalls = ensureCalls(
        s.calls ?? callsRef.current,
        curvesRef.current,
        exprSourcesRef.current,
      )
      if (nextCalls !== callsRef.current) {
        callsRef.current = nextCalls
        setCalls(nextCalls)
      }
      const nextNames = ensureNames(
        s.names ?? namesRef.current,
        {
          curves: curvesRef.current,
          sources: { ...displaySourcesRef.current, ...exprSourcesRef.current },
          calc: calcRef.current,
          inverses: inversesRef.current,
          calls: callsRef.current,
        },
        () => [...sliderLetters(curvesRef.current, exprSourcesRef.current, modelsRef.current), ...sequenceLetters(seqRef.current)],
      )
      if (nextNames !== namesRef.current) {
        namesRef.current = nextNames
        setNames(nextNames)
      }
    }
    // Compared against undefined, not truthiness: '' is a caption a teacher
    // deliberately cleared, and an undo has to be able to bring it back.
    if (s.figure !== undefined) {
      figureStyleRef.current = s.figure
      setFigureStyle(s.figure)
    }
    if (s.caption !== undefined) {
      figureCaptionRef.current = s.caption
      setFigureCaption(s.caption)
    }
    // Replaced wholesale, never mutated in place, so snapshots stay immutable.
    if (s.candidates) candidatesRef.current = s.candidates
  }, [readViewStates, writeViewStates])

  /**
   * Apply new state and push the previous snapshot onto the undo stack.
   *
   * `label` names the action in the teacher's words, not the code's, because
   * it is what the undo toast will say: "Undid: set zero".
   */
  const commitState = useCallback(
    (s: StatePatch, label = 'change'): void => {
      undoRef.current = [...undoRef.current.slice(-(HISTORY_LIMIT - 1)), takeSnapshot(label)]
      redoRef.current = []
      applyState(s)
      bumpHistory((v) => v + 1)
    },
    [applyState, takeSnapshot],
  )

  /** editEnd, for undo/redo (declared below them). */
  const editEndRef = useRef<() => void>(() => {})
  /**
   * Undo and redo first stop everything that is playing — WITHOUT committing
   * the frame it reached: related rates and the unit circle keep their play
   * position apart from the document, so dropping it leaves the document as
   * it was. The Taylor ▶ demo writes n live inside an edit bracket; the
   * bracket is closed (one undo entry, like a finished demo) and its card is
   * remounted, which clears its timer.
   */
  const haltForHistory = useCallback((): void => {
    if (rrPlayRef.current) {
      rrPlayRef.current = null
      setRrPlay(null)
    }
    if (ucPlayRef.current) {
      ucPlayRef.current = null
      setUcPlay(null)
    }
    if (statsPlayRef.current) {
      statsPlayRef.current = null
      setStatsPlay(null)
    }
    editEndRef.current()
    setPlayEpoch((e) => e + 1)
  }, [])

  const undo = useCallback((): void => {
    haltForHistory()
    const stack = undoRef.current
    if (stack.length === 0) return
    // Any answer on screen was about the state we are leaving.
    window.clearTimeout(featureNoteTimerRef.current)
    setFeatureNote(null)
    const prev = stack[stack.length - 1]
    undoRef.current = stack.slice(0, -1)
    redoRef.current = [...redoRef.current, takeSnapshot(prev.label)]
    applyState(prev)
    bumpHistory((v) => v + 1)
    setSelectedId((sel) =>
      sel &&
      (prev.curves.some((c) => c.id === sel) ||
        prev.items.some((i) => i.id === sel) ||
        prev.fields.some((f) => f.id === sel) ||
        prev.shapes.some((sh) => sh.id === sel) ||
        prev.data.some((d) => d.id === sel) ||
        prev.sequences.some((q) => q.id === sel) ||
        prev.unitCircles.some((u) => u.id === sel) ||
        prev.relatedRates.some((r) => r.id === sel) ||
        prev.stats.some((st) => st.id === sel))
        ? sel
        : null,
    )
    // An undo that moved 0.6% of the pixels on a measured board said nothing at
    // all. Now it says what it took back.
    showToast(`Undid: ${prev.label}`, { ms: 2200 })
  }, [applyState, takeSnapshot, showToast, haltForHistory])

  const redo = useCallback((): void => {
    haltForHistory()
    const stack = redoRef.current
    if (stack.length === 0) return
    window.clearTimeout(featureNoteTimerRef.current)
    setFeatureNote(null)
    const next = stack[stack.length - 1]
    redoRef.current = stack.slice(0, -1)
    undoRef.current = [...undoRef.current, takeSnapshot(next.label)]
    applyState(next)
    bumpHistory((v) => v + 1)
    setSelectedId((sel) =>
      sel &&
      (next.curves.some((c) => c.id === sel) ||
        next.items.some((i) => i.id === sel) ||
        next.fields.some((f) => f.id === sel) ||
        next.shapes.some((sh) => sh.id === sel) ||
        next.data.some((d) => d.id === sel) ||
        next.sequences.some((q) => q.id === sel) ||
        next.unitCircles.some((u) => u.id === sel) ||
        next.relatedRates.some((r) => r.id === sel) ||
        next.stats.some((st) => st.id === sel))
        ? sel
        : null,
    )
    showToast(`Redid: ${next.label}`, { ms: 2200 })
  }, [applyState, takeSnapshot, showToast, haltForHistory])

  /**
   * Live-edit bracket: capture once at edit start, commit once at edit end.
   *
   * The label is optional AND defensive: this is handed straight to React
   * event props in places (a slider's onPointerDown), so the first argument
   * can arrive as an event rather than a name.
   */
  const editStart = useCallback(
    (label?: unknown): void => {
      const name = typeof label === 'string' && label.trim() !== '' ? label : 'edit curve'
      if (!preEditRef.current) {
        preEditRef.current = takeSnapshot(name)
        setGesturing(true)
      }
    },
    [takeSnapshot],
  )

  const editEnd = useCallback((): void => {
    const pre = preEditRef.current
    preEditRef.current = null
    setGesturing(false)
    if (
      pre &&
      (pre.curves !== curvesRef.current ||
        pre.items !== itemsRef.current ||
        pre.styles !== stylesRef.current ||
        // Moving an integral's limit or dragging n changes NO curve — it
        // changes the link. Without this, the one gesture on the board that
        // leaves the curves alone was also the one gesture undo could not
        // take back. A field's slider and a dragged initial condition are the
        // same case: they move no curve at all.
        pre.calc !== calcRef.current ||
        pre.fields !== fieldsRef.current ||
        // And a dragged vertex: it rewrites the shape's own line and touches
        // no curve at all.
        pre.shapes !== shapesRef.current ||
        // And a table: a dragged regression handle can detach its link.
        pre.data !== dataRef.current ||
        // And a sequence's slider: it moves dots, never a curve.
        pre.sequences !== seqRef.current ||
        // And the unit circle's P, dragged round: it moves no curve at all.
        pre.unitCircles !== ucRef.current ||
        // And the related-rates t slider: it moves no curve either.
        pre.relatedRates !== rrRef.current ||
        // And a statistics object's dragged μ, σ or bound: no curve moves.
        pre.stats !== statsRef.current ||
        // And the inequality system's test point, dragged: no curve moves.
        pre.system !== sysRef.current)
    ) {
      undoRef.current = [...undoRef.current.slice(-(HISTORY_LIMIT - 1)), pre]
      redoRef.current = []
      bumpHistory((v) => v + 1)
    }
  }, [])
  editEndRef.current = editEnd

  /** Abort the live edit bracket, reverting to the pre-edit state (no history). */
  const editCancel = useCallback((): void => {
    const pre = preEditRef.current
    preEditRef.current = null
    setGesturing(false)
    if (pre) applyState(pre)
  }, [applyState])

  /** Commit the edit bracket, magnetizing params to nice values first.
   *  Snaps only while a bracket is actually open, and never when Alt is held. */
  const commitWithSnap = useCallback(
    (curveId: string | null, skipSnap: boolean): void => {
      if (curveId && !skipSnap && !altRef.current && preEditRef.current) {
        const c = curvesRef.current.find((cv) => cv.id === curveId)
        if (c) {
          try {
            const spec = modelsRef.current[c.modelId]
            const res = spec
              ? snapParams(c.modelId, c.params, {
                  spec,
                  domain: c.domain,
                  error: c.error,
                })
              : null
            if (res && res.snapped.some(Boolean)) {
              applyState({
                curves: curvesRef.current.map((cv) =>
                  cv.id === curveId ? { ...cv, params: res.params.slice() } : cv,
                ),
              })
              window.clearTimeout(snapTimerRef.current)
              setSnapFlash({ id: curveId, mask: res.snapped, key: Date.now() })
              snapTimerRef.current = window.setTimeout(() => setSnapFlash(null), 600)
            }
          } catch {
            /* snapping is best-effort */
          }
        }
      }
      editEnd()
    },
    [applyState, editEnd],
  )

  // ------------------------------------------------------- curve provenance
  //
  // A sketched curve starts as a READING OF ITS INK, and σ on its card is the
  // distance between the two. Every edit after that — a typed equation, a
  // stated feature, a dragged handle, a typed coefficient — makes the ink a
  // description of something the curve no longer is. Two things depend on
  // knowing which: the card stops showing σ, and asking for another reading
  // stops being free (it refits the ORIGINAL sketch, which would throw the
  // edits away without saying so).

  /** The edit map with one more entry for `id`. Goes INTO the commit's patch. */
  const withEdit = useCallback((id: string, edit: CurveEdit): Record<string, CurveEdit[]> => {
    const list = editsRef.current[id] ?? []
    return { ...editsRef.current, [id]: [...list, edit] }
  }, [])

  /** Record an edit made inside a live bracket (a drag), once per kind. */
  const noteEdit = useCallback((id: string, edit: CurveEdit): void => {
    const list = editsRef.current[id] ?? []
    if (edit.kind !== 'feature' && list.some((e) => e.kind === edit.kind)) return
    const next = { ...editsRef.current, [id]: [...list, edit] }
    editsRef.current = next
    setEdits(next)
  }, [])

  // Track Alt so slider/nudge commits can honor "hold Alt to skip snapping".
  useEffect(() => {
    const onDown = (e: KeyboardEvent): void => {
      if (e.key === 'Alt') altRef.current = true
    }
    const onUp = (e: KeyboardEvent): void => {
      if (e.key === 'Alt') altRef.current = false
    }
    const onBlur = (): void => {
      altRef.current = false
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  return {
    applyState, commitState, undo, redo, editStart, editEnd, editCancel, commitWithSnap, withEdit,
    noteEdit,
  }
}

export type HistoryApi = ReturnType<typeof useHistory>

// ============================================================================
// src/app/useCurveEditing.ts — curve CRUD, drag / nudge editing, feature editing and curve style.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useCallback } from 'react'
import { applyFeatureEdit } from '../core/fit/edit'
import { parseExpression } from '../core/parse'
import {
  ACCUM_MODEL_PREFIX,
  DERIV_MODEL_PREFIX,
  INV_MODEL_PREFIX,
  TAYLOR_MODEL_PREFIX,
} from '../core/persist'
import type {
  AccumulationLink,
  CurveStyle,
  DerivativeLink,
  InverseLink,
  StyleMap,
  TaylorLink,
} from '../core/persist'
import { CURVE_COLORS, nextId } from '../core/types'
import type {
  CurveEnds,
  EndCap,
  FeatureEditResult,
  FitResult,
  FittedCurve,
  ModelSpec,
  ProcessedStroke,
  SpecialPoint,
} from '../core/types'
import { typedName } from '../render/curveNames'
import {
  countPhrase,
  dependentsOf,
  inverseTypedLine,
  linkNoun,
  taylorTypedLine,
} from '../ui/calcLinks'
import type { CalcLink } from '../ui/calcLinks'
import { splitNotice } from '../ui/curveState'
import { dropRegressionsFor } from '../ui/dataLinks'
import type { BoardData } from '../ui/dataLinks'
import { splitTyped } from '../ui/domainLinks'
import { curveEquationText } from '../ui/equationText'
import { describePoints } from '../ui/featureEdit'
import {
  awaitedLetters,
  inverseDependents,
  nextFreeLetter,
  orphanNotice,
  rewriteName,
  sliderLetters,
} from '../ui/nameLinks'
import { sequenceLetters } from '../ui/seqLinks'
import { safePoly, taylorSourceFor } from '../ui/taylorLinks'
import { END_CAP_WORDS, NO_CANDIDATES } from './constants'
import type { CurveEdit } from './types'
import type { BoardStateApi } from './useBoardState'
import type { SessionStateApi } from './useSessionState'
import type { BoardRefsApi } from './useBoardRefs'
import type { ModelsApi } from './useModels'
import type { NoticesApi } from './useNotices'
import type { HistoryApi } from './useHistory'

/** What useCurveEditing reads from the hooks App calls before it. */
export interface CurveEditingDeps {
  board: BoardStateApi
  session: SessionStateApi
  refs: BoardRefsApi
  derived: ModelsApi
  notices: NoticesApi
  history: HistoryApi
}

export function useCurveEditing({ board, session, refs, derived, notices, history }: CurveEditingDeps) {
  const { setSelectedId, setShake, setToast, setConfirmAsk } = board
  const { featureNote, setFeatureNote, featureNoteTimerRef } = session
  const {
    curvesRef, itemsRef, kindRef, stylesRef, selectedRef, candidatesRef, exprCounterRef,
    shakeTimerRef, toastTimerRef, exprSourcesRef, brokenExprRef, displaySourcesRef, editsRef,
    calcRef, fieldsRef, shapesRef, dataRef, seqRef, ucRef, rrRef, statsRef, namesRef, callsRef, inversesRef,
    derivCounterRef,
  } = refs
  const { modelsRef, registerModels, envFor, analysisRef } = derived
  const { showToast, showFeatureNote } = notices
  const { applyState, commitState, undo, editStart, withEdit, noteEdit } = history

  // -------------------------------------------------------------- curve CRUD
  const pickColor = useCallback((): string => {
    const onBoard =
      kindRef.current === 'number-line'
        ? itemsRef.current.map((i) => i.color)
        : [
            ...curvesRef.current.map((c) => c.color),
            // A slope field is in the same list and the same palette: handing
            // a new field the colour of the curve above it would be the one
            // collision the cycle exists to prevent.
            ...fieldsRef.current.map((f) => f.color),
            // And a shape, for the same reason again: one list, one palette.
            ...shapesRef.current.map((sh) => sh.color),
            ...dataRef.current.map((d) => d.color),
            ...seqRef.current.map((q) => q.color),
          ]
    const used = new Set(onBoard)
    for (const color of CURVE_COLORS) {
      if (!used.has(color)) return color
    }
    return CURVE_COLORS[onBoard.length % CURVE_COLORS.length]
  }, [])

  const handleStrokeRecognized = useCallback(
    (processed: ProcessedStroke, results: FitResult[]): FittedCurve | null => {
      const best = results[0]
      if (!best) return null
      const curve: FittedCurve = {
        id: nextId(),
        modelId: best.modelId,
        params: best.params.slice(),
        kind: best.kind,
        domain: best.domain,
        color: pickColor(),
        strokeWidth: 2.5,
        visible: true,
        sourceStroke: processed.points,
        error: best.error,
      }
      commitState(
        {
          curves: [...curvesRef.current, curve],
          candidates: new Map(candidatesRef.current).set(curve.id, results),
        },
        'draw curve',
      )
      setSelectedId(curve.id)
      return curve
    },
    [commitState, pickColor],
  )

  /** Everything `ids` owns, transitively: the curves and the links. */
  const removeWithDependents = useCallback(
    (
      ids: string[],
      label: string,
      /** The tables as they should be after this commit (a table being deleted). */
      dataBase: BoardData[] = dataRef.current,
    ): { curves: FittedCurve[]; lost: CalcLink[]; lostInverses: InverseLink[] } => {
      // The calculus dependents, then the inverses of everything going, then
      // the calculus dependents of THOSE — an inverse is a curve too.
      let dead = dependentsOf(calcRef.current, ids)
      const inv = inverseDependents(inversesRef.current, dead.curveIds)
      if (inv.curveIds.size > 0) {
        dead = dependentsOf(calcRef.current, [...dead.curveIds, ...inv.curveIds])
      }
      const invDead = inverseDependents(inversesRef.current, dead.curveIds)
      const lostInverses = inversesRef.current.filter((l) => invDead.linkIds.has(l.id))
      const lost = calcRef.current.filter((l) => dead.linkIds.has(l.id))
      const curves = curvesRef.current.filter((c) => !dead.curveIds.has(c.id))
      const styles: StyleMap = {}
      for (const [id, st] of Object.entries(stylesRef.current)) {
        if (!dead.curveIds.has(id)) styles[id] = st
      }
      const exprSources: Record<string, string> = {}
      for (const [id, src] of Object.entries(exprSourcesRef.current)) {
        if (!dead.curveIds.has(id)) exprSources[id] = src
      }
      const brokenExpr: Record<string, string> = {}
      for (const [id, why] of Object.entries(brokenExprRef.current)) {
        if (!dead.curveIds.has(id)) brokenExpr[id] = why
      }
      const displaySources: Record<string, string> = {}
      for (const [id, src] of Object.entries(displaySourcesRef.current)) {
        if (!dead.curveIds.has(id)) displaySources[id] = src
      }
      const edits: Record<string, CurveEdit[]> = {}
      for (const [id, list] of Object.entries(editsRef.current)) {
        if (!dead.curveIds.has(id)) edits[id] = list
      }
      commitState(
        {
          curves,
          calc: calcRef.current.filter((l) => !dead.linkIds.has(l.id)),
          styles,
          exprSources,
          brokenExpr,
          displaySources,
          edits,
          // A regression whose curve goes is not a regression any more: the
          // entry leaves its table in the same commit.
          data: dropRegressionsFor(dataBase, dead.curveIds),
          ...(lostInverses.length > 0
            ? { inverses: inversesRef.current.filter((l) => !invDead.linkIds.has(l.id)) }
            : {}),
        },
        label,
      )
      setSelectedId((sel) => (sel && dead.curveIds.has(sel) ? null : sel))
      return { curves, lost, lostInverses }
    },
    [commitState],
  )

  const deleteCurve = useCallback(
    (id: string): void => {
      // Everything the curve owns goes in ONE commit — its styles, its
      // equation text, and the calculus objects that only exist because it
      // does. A tangent left behind pointing at nothing is not a curve the
      // board can draw, and a second undo to finish the job is not an undo.
      // Lines that CALL this curve are not its dependents: they stay, in
      // their error state, and come back to life if the curve does. Read
      // before the commit, while the curve still has its name.
      const namesBefore = namesRef.current
      const callsBefore = callsRef.current
      const gone = namesBefore[id] ? namesBefore[id] : 'the curve'
      const { lost, lostInverses } = removeWithDependents([id], 'delete curve')
      const orphans = orphanNotice([id], namesBefore, callsBefore)
      const count = lost.length + lostInverses.length
      if (count === 0 && !orphans) return
      const kinds = [
        ...new Set([
          ...lost.map((l) => linkNoun(l.kind)),
          ...lostInverses.map(() => 'inverse'),
        ]),
      ].join(', ')
      const took =
        count > 0
          ? `Deleted ${gone} and ${countPhrase(count, 'thing')} that depended on it (${kinds}).`
          : `Deleted ${gone}.`
      showToast(`${took}${orphans ? ` ${orphans}.` : ''} Undo brings ${count > 0 ? 'all of it' : 'it'} back.`, {
        ms: orphans ? 6500 : 5000,
        action: { label: 'Undo', run: undo },
      })
    },
    [removeWithDependents, showToast, undo],
  )

  const clearAll = useCallback((): void => {
    // Clears what this board is actually showing; the other kind's contents are
    // not on screen, so wiping them would be a deletion the user can't see.
    if (kindRef.current === 'number-line') {
      if (itemsRef.current.length === 0) return
      const styles: StyleMap = {}
      for (const c of curvesRef.current) {
        const st = stylesRef.current[c.id]
        if (st) styles[c.id] = st
      }
      commitState({ items: [], styles }, 'remove everything on the line')
      setSelectedId(null)
      return
    }
    if (
      curvesRef.current.length === 0 &&
      fieldsRef.current.length === 0 &&
      shapesRef.current.length === 0 &&
      dataRef.current.length === 0 &&
      seqRef.current.length === 0 &&
      ucRef.current.length === 0 &&
      rrRef.current.length === 0 &&
      statsRef.current.length === 0
    ) {
      return
    }
    const styles: StyleMap = {}
    for (const it of itemsRef.current) {
      const st = stylesRef.current[it.id]
      if (st) styles[it.id] = st
    }
    commitState(
      {
        curves: [],
        calc: [],
        fields: [],
        shapes: [],
        data: [],
        sequences: [],
        unitCircles: [],
        relatedRates: [],
        stats: [],
        system: null,
        styles,
        exprSources: {},
        brokenExpr: {},
        displaySources: {},
        edits: {},
        names: {},
        calls: {},
        inverses: [],
      },
      'remove all curves',
    )
    setSelectedId(null)
  }, [commitState])

  const toggleVisible = useCallback(
    (id: string): void => {
      const now = curvesRef.current.find((c) => c.id === id)
      commitState(
        {
          curves: curvesRef.current.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c)),
        },
        now && now.visible ? 'hide curve' : 'show curve',
      )
    },
    [commitState],
  )

  const cycleColor = useCallback(
    (id: string): void => {
      commitState(
        {
          curves: curvesRef.current.map((c) => {
            if (c.id !== id) return c
            const idx = CURVE_COLORS.indexOf(c.color)
            const next = CURVE_COLORS[(idx + 1 + CURVE_COLORS.length) % CURVE_COLORS.length]
            return { ...c, color: next }
          }),
        },
        'change color',
      )
    },
    [commitState],
  )

  const setParam = useCallback(
    (id: string, index: number, value: number): void => {
      noteEdit(id, { kind: 'param' })
      applyState({
        curves: curvesRef.current.map((c) =>
          c.id === id
            ? { ...c, params: c.params.map((p, i) => (i === index ? value : p)) }
            : c,
        ),
      })
    },
    [applyState, noteEdit],
  )

  /**
   * Read this sketch as something else.
   *
   * The candidate was fitted to the ORIGINAL ink, so applying it throws away
   * everything done to the curve since — and it used to do that silently, with
   * no way back other than an undo nobody knew they needed (clicking the first
   * family again does NOT restore the edits; it refits the ink a second time).
   *
   * So: a curve that has only ever been READ is switched straight over. A curve
   * that has been edited gets its feature edits RE-STATED against the new
   * family first — "the zero is at −2" is a fact about the curve, not about the
   * cubic — and only when that is impossible is the teacher asked, once, in one
   * line. Either way it is a single undo step.
   */
  const applyCandidate = useCallback(
    (id: string, cand: FitResult): void => {
      const curve = curvesRef.current.find((c) => c.id === id)
      if (!curve) return
      const name = modelsRef.current[cand.modelId]?.name ?? cand.modelId
      const label = `read as ${name.toLowerCase()}`
      const refit: FittedCurve = {
        ...curve,
        modelId: cand.modelId,
        params: cand.params.slice(),
        kind: cand.kind,
        domain: cand.domain,
        error: cand.error,
      }
      const put = (next: FittedCurve, edits: Record<string, CurveEdit[]>): void => {
        const { [id]: _src, ...displaySources } = displaySourcesRef.current
        commitState(
          {
            curves: curvesRef.current.map((c) => (c.id === id ? next : c)),
            displaySources,
            edits,
          },
          label,
        )
        setSelectedId(id)
      }

      const history = editsRef.current[id] ?? []
      if (history.length === 0) {
        put(refit, editsRef.current)
        return
      }

      // Replayable only when every edit was a stated FEATURE: a typed equation
      // or a dragged handle has no restatement in another family.
      if (history.every((e) => e.kind === 'feature')) {
        let work = refit
        let ok = true
        for (const e of history) {
          if (e.kind !== 'feature') continue
          try {
            const res = applyFeatureEdit(work, modelsRef.current, { point: e.point, to: e.to })
            if (!res || !res.ok || !Array.isArray(res.params) || res.params.some((v) => !Number.isFinite(v))) {
              ok = false
              break
            }
            work = { ...work, params: res.params.slice(), domain: res.domain }
          } catch {
            ok = false
            break
          }
        }
        if (ok) {
          put(work, editsRef.current)
          showFeatureNote({
            kind: 'moved',
            key: Date.now(),
            text: `Read as a ${name.toLowerCase()}, with your ${history.length === 1 ? 'edit' : `${history.length} edits`} re-applied.`,
          })
          return
        }
      }

      setConfirmAsk({
        key: Date.now(),
        text: `This refits your original sketch as a ${name.toLowerCase()} and discards the edits you made — continue?`,
        yes: 'Refit anyway',
        run: () => {
          const { [id]: _gone, ...edits } = editsRef.current
          put(refit, edits)
        },
      })
    },
    [commitState, showFeatureNote],
  )

  const candidatesFor = useCallback(
    // One shared empty list: a fresh [] per call made every card's memo miss.
    (id: string): FitResult[] => candidatesRef.current.get(id) ?? NO_CANDIDATES,
    [],
  )

  // ----------------------------------------------------- drag / nudge editing
  /** Live param+stroke update during a canvas drag (history handled by editStart/End). */
  const dragCurveLive = useCallback(
    (id: string, params: number[], stroke?: { x: number; y: number }[]): void => {
      noteEdit(id, { kind: 'handle' })
      applyState({
        curves: curvesRef.current.map((c) =>
          c.id === id ? { ...c, params, ...(stroke ? { sourceStroke: stroke } : {}) } : c,
        ),
      })
    },
    [applyState, noteEdit],
  )

  /** Live param+domain update during a handle drag. */
  const handleDragLive = useCallback(
    (id: string, params: number[], domain: [number, number] | null): void => {
      noteEdit(id, { kind: 'handle' })
      applyState({
        curves: curvesRef.current.map((c) => (c.id === id ? { ...c, params, domain } : c)),
      })
    },
    [applyState, noteEdit],
  )

  /** Successful oversketch refit: one undoable commit. */
  const oversketchApply = useCallback(
    (id: string, params: number[], error: number): void => {
      commitState(
        {
          curves: curvesRef.current.map((c) => (c.id === id ? { ...c, params, error } : c)),
        },
        'blend stroke',
      )
    },
    [commitState],
  )

  /**
   * A transient notice the STAGE raised, naming something undoable that just
   * happened ("Blended into this curve · Undo"). It arrives as text with the
   * word Undo in it; here it becomes a real button, because a sentence that
   * says Undo and cannot be pressed is worse than no sentence.
   */
  const showNotice = useCallback(
    (text: string): void => {
      const { msg, undoable } = splitNotice(text)
      showToast(msg, undoable ? { action: { label: 'Undo', run: undo } } : undefined)
    },
    [showToast, undo],
  )

  /** Oversketch couldn't blend the stroke: shake the card, brief toast. */
  const oversketchFail = useCallback((id: string): void => {
    window.clearTimeout(shakeTimerRef.current)
    window.clearTimeout(toastTimerRef.current)
    window.clearTimeout(featureNoteTimerRef.current)
    setFeatureNote(null)
    const key = Date.now()
    setShake({ id, key })
    setToast({ msg: 'Couldn’t blend that stroke', key })
    shakeTimerRef.current = window.setTimeout(() => setShake(null), 500)
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2000)
  }, [])

  /** Exact value typed into a card readout: one undoable commit, no snapping. */
  const setParamExact = useCallback(
    (id: string, index: number, value: number): void => {
      commitState(
        {
          curves: curvesRef.current.map((c) =>
            c.id === id
              ? { ...c, params: c.params.map((p, i) => (i === index ? value : p)) }
              : c,
          ),
          edits: withEdit(id, { kind: 'param' }),
        },
        'set coefficient',
      )
    },
    [commitState, withEdit],
  )

  // -------------------------------------------------------- feature editing
  //
  // "Put this zero at x = −2." The teacher states a fact about the curve and
  // the solver decides whether the family can honour it. Three outcomes, all of
  // which must reach the teacher:
  //   ok            — one undoable commit, and NO snapParams (see below).
  //   ok + alsoMoved— the same commit, plus a report of what else shifted.
  //   refused       — nothing changes; the solver's own sentence is shown.

  /**
   * Returns true when the curve actually changed (the caller closes its editor)
   * and false when it did not, so a refusal leaves the typed value on screen.
   */
  const applyFeature = useCallback(
    (curveId: string, point: SpecialPoint, to: { x?: number; y?: number }): boolean => {
      const curve = curvesRef.current.find((c) => c.id === curveId)
      if (!curve) return true

      const refuse = (reason: string): boolean => {
        showFeatureNote({ kind: 'refused', key: Date.now(), reason })
        return false
      }

      /**
       * Hold the point's SIBLINGS OF THE SAME KIND still.
       *
       * Without this, "set the zeros to −2, 1, 3" never converges: each edit is
       * free to slide the other two, so fixing the second undoes the first and
       * the teacher chases the numbers around forever. Same-kind is the pin rule
       * a teacher already has in their head — "these zeros stay, move this one" —
       * and it is the only one that makes the three-in-a-row workflow terminate.
       * Cross-kind pinning is deliberately NOT attempted: a cubic's maximum,
       * minimum and inflection are not independent, and pretending otherwise
       * would manufacture refusals the family never actually earned. The solver
       * drops the pins itself when honouring them would over-determine the curve.
       */
      // analysisRef holds the SELECTED curve's points only, so pin from it only
      // when that is the curve being edited.
      const pinned =
        curveId === selectedRef.current
          ? analysisRef.current.filter((p) => p !== point && p.kind === point.kind)
          : []

      let res: FeatureEditResult
      try {
        res = applyFeatureEdit(curve, modelsRef.current, {
          point,
          to,
          ...(pinned.length > 0 ? { pinned } : {}),
        })
      } catch {
        return refuse('That change couldn’t be worked out for this curve.')
      }
      if (!res || typeof res !== 'object' || typeof res.ok !== 'boolean') {
        return refuse('That change couldn’t be worked out for this curve.')
      }

      if (!res.ok) {
        // The reason is written for a teacher and is shown WORD FOR WORD; the
        // fallback exists only for a solver that returned no sentence at all.
        const reason =
          typeof res.reason === 'string' && res.reason.trim() !== ''
            ? res.reason
            : 'That isn’t something this curve can do.'
        const near = res.nearest
        showFeatureNote({
          kind: 'refused',
          key: Date.now(),
          reason,
          // Offered as a choice, never applied behind the teacher's back.
          ...(near && Array.isArray(near.params)
            ? { nearest: { curveId, params: near.params.slice(), domain: near.domain } }
            : {}),
        })
        return false
      }

      if (!Array.isArray(res.params) || res.params.some((p) => !Number.isFinite(p))) {
        return refuse('That change couldn’t be worked out for this curve.')
      }

      // ONE undo entry, and deliberately no snapParams: the teacher stated an
      // exact fact, exactly as with a typed coordinate. Magnetizing "x = −2" to
      // something rounder would destroy the very thing that was just asserted —
      // the same inversion HandleInput.tsx documents for typed values.
      commitState(
        {
          curves: curvesRef.current.map((c) =>
            c.id === curveId ? { ...c, params: res.params.slice(), domain: res.domain } : c,
          ),
          // Recorded so another reading of the same sketch can re-state it.
          edits: withEdit(curveId, { kind: 'feature', point, to }),
        },
        `set ${point.label}`,
      )

      const moved = Array.isArray(res.alsoMoved) ? res.alsoMoved : []
      const parts: string[] = []
      if (moved.length > 0) {
        const text = describePoints(moved)
        if (text) parts.push(`Also moved: ${text}`)
      }
      if (res.exact === false) parts.push('Placed as closely as this family allows.')
      showFeatureNote(
        parts.length > 0 ? { kind: 'moved', key: Date.now(), text: parts.join(' · ') } : null,
      )
      return true
    },
    [commitState, showFeatureNote, withEdit],
  )

  /** Card readout path: the index is into the selected curve's analysis. */
  const applyFeatureByIndex = useCallback(
    (curveId: string, index: number, to: { x?: number; y?: number }): boolean => {
      if (curveId !== selectedRef.current) return true
      const point = analysisRef.current[index]
      if (!point) return true
      return applyFeature(curveId, point, to)
    },
    [applyFeature],
  )

  /** The explicit "yes, take the nearest one" — its own undo entry. */
  const applyNearestFeature = useCallback((): void => {
    const note = featureNote
    if (!note || note.kind !== 'refused' || !note.nearest) return
    const { curveId, params, domain } = note.nearest
    setFeatureNote(null)
    if (!curvesRef.current.some((c) => c.id === curveId)) return
    commitState({
      curves: curvesRef.current.map((c) =>
        c.id === curveId ? { ...c, params: params.slice(), domain } : c,
      ),
    })
  }, [commitState, featureNote])

  /** Keyboard nudge of the selected curve; returns true if it moved. */
  const nudgeSelected = useCallback(
    (dx: number, dy: number): boolean => {
      const sel = curvesRef.current.find((c) => c.id === selectedRef.current)
      if (!sel) return false
      const spec = modelsRef.current[sel.modelId]
      if (!spec || !spec.translate) return false
      try {
        const params = spec.translate(sel.params, dx, dy)
        const stroke = sel.sourceStroke?.map((p) => ({ x: p.x + dx, y: p.y + dy }))
        editStart()
        applyState({
          curves: curvesRef.current.map((c) =>
            c.id === sel.id ? { ...c, params, ...(stroke ? { sourceStroke: stroke } : {}) } : c,
          ),
        })
        return true
      } catch {
        return false
      }
    },
    [applyState, editStart],
  )

  /**
   * A duplicate of a DERIVED curve — one drawn by a closure the board rebuilds
   * from its link (tay_<link>, inv_<link>, dfdx_N, intf_<link>). A copy with
   * no link would share the original's model, follow it, and be dropped on
   * reload. So a Taylor polynomial or an inverse relation is FROZEN as the
   * typed line it is now (a snapshot); a derivative or an accumulation
   * function, which has no typed form, gets a link of its own to the same
   * parent, so the loader rebuilds it like the original. Null: not derived.
   */
  const derivedCopyPlan = useCallback(
    (
      src: FittedCurve,
    ):
      | { kind: 'line'; line: string; calls: string[] | null; params: number[] | null }
      | { kind: 'link'; link: CalcLink; modelId: string }
      | { kind: 'refuse'; why: string }
      | null => {
      const id = src.id
      const models = modelsRef.current
      if (src.modelId.startsWith(TAYLOR_MODEL_PREFIX)) {
        const link = calcRef.current.find((l): l is TaylorLink => l.kind === 'taylor' && l.curveId === id)
        const parent = link && curvesRef.current.find((c) => c.id === link.parentId)
        let line: string | null = null
        if (link && parent) {
          try {
            const tsrc = taylorSourceFor(parent, models, (callsRef.current[parent.id]?.length ?? 0) > 0)
            const poly = safePoly(tsrc, link.a, link.n)
            line = poly ? taylorTypedLine(poly) : null
          } catch {
            line = null
          }
        }
        return line
          ? { kind: 'line', line, calls: null, params: null }
          : { kind: 'refuse', why: 'This Taylor polynomial has no polynomial to copy at this center.' }
      }
      if (src.modelId.startsWith(INV_MODEL_PREFIX)) {
        const link = inversesRef.current.find((l) => l.curveId === id)
        const parent = link && curvesRef.current.find((c) => c.id === link.parentId)
        let base: string | null = null
        if (parent) {
          const typed = exprSourcesRef.current[parent.id]
          if (parent.modelId.startsWith('expr_') && typed) {
            const split = splitTyped(typed)
            base = split && split !== 'piecewise' && !split.cond ? split.base : null
          } else {
            try {
              base = curveEquationText(parent, models[parent.modelId])
            } catch {
              base = null
            }
          }
        }
        const line = base ? inverseTypedLine(base, src.domain) : null
        if (!line || !parent) {
          return { kind: 'refuse', why: 'This inverse has no formula to copy — it follows its curve.' }
        }
        const lineCalls = callsRef.current[parent.id]
        return {
          kind: 'line',
          line,
          calls: lineCalls && lineCalls.length > 0 ? lineCalls.slice() : null,
          params: parent.params.slice(),
        }
      }
      const drove = calcRef.current.find(
        (l): l is DerivativeLink | AccumulationLink =>
          (l.kind === 'derivative' || l.kind === 'accumulation') && l.curveId === id,
      )
      if (
        drove &&
        (src.modelId.startsWith(DERIV_MODEL_PREFIX) || src.modelId.startsWith(ACCUM_MODEL_PREFIX))
      ) {
        const linkId = nextId()
        const modelId =
          drove.kind === 'accumulation'
            ? `${ACCUM_MODEL_PREFIX}${linkId}`
            : `${DERIV_MODEL_PREFIX}${++derivCounterRef.current}`
        return { kind: 'link', link: { ...drove, id: linkId, curveId: '' }, modelId }
      }
      return null
    },
    [],
  )

  const duplicateCurve = useCallback(
    (id: string): void => {
      const src = curvesRef.current.find((c) => c.id === id)
      if (!src) return
      const plan = derivedCopyPlan(src)
      if (plan && plan.kind === 'refuse') {
        showFeatureNote({ kind: 'moved', key: Date.now(), text: plan.why })
        return
      }
      if (plan && plan.kind === 'line') {
        // Frozen: a new typed curve, parsed from the line it is now.
        let outcome: ReturnType<typeof parseExpression>
        try {
          outcome = parseExpression(plan.line, envFor(plan.calls ?? [], null))
        } catch {
          return
        }
        if (!outcome.ok) {
          showFeatureNote({ kind: 'moved', key: Date.now(), text: `This curve could not be copied: ${outcome.error}` })
          return
        }
        const modelId = `expr_${++exprCounterRef.current}`
        let made: ModelSpec
        try {
          made = outcome.plot.makeModel(modelId)
        } catch {
          return
        }
        registerModels({ [modelId]: made })
        const params =
          plan.params && plan.params.length === outcome.plot.defaultParams.length
            ? plan.params.slice()
            : outcome.plot.defaultParams.slice()
        const frozen: FittedCurve = {
          id: nextId(),
          modelId,
          params,
          kind: outcome.plot.kind,
          domain: outcome.plot.domain,
          color: pickColor(),
          strokeWidth: src.strokeWidth,
          visible: true,
          error: 0,
        }
        const st = stylesRef.current[id]
        commitState(
          {
            curves: [...curvesRef.current, frozen],
            exprSources: { ...exprSourcesRef.current, [frozen.id]: plan.line },
            ...(plan.calls ? { calls: { ...callsRef.current, [frozen.id]: plan.calls } } : {}),
            ...(st ? { styles: { ...stylesRef.current, [frozen.id]: st } } : {}),
          },
          'duplicate curve',
        )
        setSelectedId(frozen.id)
        return
      }
      const spec = modelsRef.current[src.modelId]
      let params = src.params.slice()
      let stroke = src.sourceStroke
      if (spec && spec.translate) {
        try {
          params = spec.translate(src.params, 0.5, -0.5)
          stroke = stroke?.map((p) => ({ x: p.x + 0.5, y: p.y - 0.5 }))
        } catch {
          params = src.params.slice()
          stroke = src.sourceStroke
        }
      }
      const copy: FittedCurve = {
        ...src,
        id: nextId(),
        params,
        color: pickColor(),
        ...(stroke ? { sourceStroke: stroke } : {}),
      }
      // A derivative or accumulation copy: its own link to the same parent,
      // its own model id; syncCalc builds the model from the link.
      const ownLink: CalcLink | null =
        plan && plan.kind === 'link' ? ({ ...plan.link, curveId: copy.id } as CalcLink) : null
      if (plan && plan.kind === 'link') copy.modelId = plan.modelId
      const cands = candidatesRef.current.get(id)
      let srcExpr = exprSourcesRef.current[id]
      const brokenWhy = brokenExprRef.current[id]
      const st = stylesRef.current[id]
      let shownSrc = displaySourcesRef.current[id]
      const madeEdits = editsRef.current[id]
      // A copy is a new curve with a letter of its own. A copy of
      // `g(x) = 2f(x − 1) + 3` says so in its head, calls what g calls, and
      // gets a model parsed for its own name.
      const lineCalls = callsRef.current[id]
      const head = typedName(srcExpr ?? shownSrc)
      let copyName: string | null = null
      if (head) {
        copyName = nextFreeLetter(
          new Set(Object.values(namesRef.current)),
          new Set([
            ...awaitedLetters(callsRef.current),
            ...sliderLetters(curvesRef.current, exprSourcesRef.current, modelsRef.current),
            ...sequenceLetters(seqRef.current),
          ]),
        )
        if (copyName) {
          if (srcExpr !== undefined) srcExpr = rewriteName(srcExpr, head, copyName, { head: true })
          if (shownSrc !== undefined) shownSrc = rewriteName(shownSrc, head, copyName, { head: true })
        }
      }
      if (copyName && srcExpr !== undefined && srcExpr !== exprSourcesRef.current[id]) {
        try {
          const o = parseExpression(srcExpr, envFor(lineCalls ?? [], copyName))
          if (o.ok) {
            const modelId = `expr_${++exprCounterRef.current}`
            registerModels({ [modelId]: o.plot.makeModel(modelId) })
            copy.modelId = modelId
          }
        } catch {
          /* the copy keeps sharing the original's model */
        }
      }
      commitState(
        {
          ...(copyName ? { names: { ...namesRef.current, [copy.id]: copyName } } : {}),
          ...(lineCalls ? { calls: { ...callsRef.current, [copy.id]: lineCalls.slice() } } : {}),
          curves: [...curvesRef.current, copy],
          ...(st ? { styles: { ...stylesRef.current, [copy.id]: st } } : {}),
          ...(cands ? { candidates: new Map(candidatesRef.current).set(copy.id, cands) } : {}),
          ...(srcExpr !== undefined
            ? { exprSources: { ...exprSourcesRef.current, [copy.id]: srcExpr } }
            : {}),
          ...(brokenWhy !== undefined
            ? { brokenExpr: { ...brokenExprRef.current, [copy.id]: brokenWhy } }
            : {}),
          ...(shownSrc !== undefined
            ? { displaySources: { ...displaySourcesRef.current, [copy.id]: shownSrc } }
            : {}),
          ...(madeEdits !== undefined
            ? { edits: { ...editsRef.current, [copy.id]: madeEdits.slice() } }
            : {}),
          ...(ownLink ? { calc: [...calcRef.current, ownLink] } : {}),
        },
        'duplicate curve',
      )
      setSelectedId(copy.id)
    },
    [commitState, envFor, pickColor, registerModels, derivedCopyPlan, showFeatureNote],
  )

  // ------------------------------------------------------------- curve style
  const setStrokeWidth = useCallback(
    (id: string, width: number): void => {
      applyState({
        curves: curvesRef.current.map((c) => (c.id === id ? { ...c, strokeWidth: width } : c)),
      })
    },
    [applyState],
  )

  const setDash = useCallback(
    (id: string, dash: number[] | undefined): void => {
      commitState(
        { styles: { ...stylesRef.current, [id]: { ...stylesRef.current[id], dash } } },
        'change line style',
      )
    },
    [commitState],
  )

  /**
   * One end of one curve gets a cap. 'auto' is not stored — it is the absence
   * of a choice, the state in which the figure style answers — so choosing it
   * REMOVES the end, and a style whose ends are both back to auto loses the
   * key entirely. That keeps the style map saying only what a teacher said.
   */
  const setEnds = useCallback(
    (id: string, which: 'start' | 'end', cap: EndCap): void => {
      const prev = stylesRef.current[id]
      const ends: CurveEnds = { ...prev?.ends }
      if (cap === 'auto') delete ends[which]
      else ends[which] = cap
      const next: CurveStyle = { ...prev }
      if (ends.start === undefined && ends.end === undefined) delete next.ends
      else next.ends = ends
      commitState(
        { styles: { ...stylesRef.current, [id]: next } },
        `curve ends: ${END_CAP_WORDS[cap]}`,
      )
    },
    [commitState],
  )

  const setOpacity = useCallback(
    (id: string, opacity: number): void => {
      applyState({
        styles: { ...stylesRef.current, [id]: { ...stylesRef.current[id], opacity } },
      })
    },
    [applyState],
  )

  return {
    pickColor, handleStrokeRecognized, removeWithDependents, deleteCurve, clearAll, toggleVisible,
    cycleColor, setParam, applyCandidate, candidatesFor, dragCurveLive, handleDragLive,
    oversketchApply, showNotice, oversketchFail, setParamExact, applyFeature, applyFeatureByIndex,
    applyNearestFeature, nudgeSelected, duplicateCurve, setStrokeWidth, setDash, setEnds,
    setOpacity,
  }
}

export type CurveEditingApi = ReturnType<typeof useCurveEditing>

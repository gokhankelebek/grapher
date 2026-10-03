// ============================================================================
// src/app/useRevealMode.ts — reveal mode's wiring: inventory, stepping and the scene mask.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { tableKeysOf } from '../ui/valueTableLinks'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { asymptoteTexts } from '../ui/CurveCard'
import { solveCached, solveXs } from '../ui/nlSolve'
import {
  buildInventory,
  eulerKey,
  hideAll,
  hideLast,
  isHidden,
  REVEAL_OFF,
  revealAll,
  revealCount,
  revealNext,
  revealOne,
  rrKey,
  seriesKey,
  statKey,
  solveKey,
  SYSTEM_KEY,
  ucKey,
} from '../ui/reveal'
import type { RevealInventory, SceneReveal } from '../ui/reveal'
import { REVEAL_API_OFF } from '../ui/RevealAnswer'
import type { RevealApi } from '../ui/RevealAnswer'
import type { RevealControlsProps } from '../ui/RevealControls'
import { EMPTY_CONTEXT } from './constants'
import type { BoardStateApi } from './useBoardState'
import type { DocumentStateApi } from './useDocumentState'
import type { SessionStateApi } from './useSessionState'
import type { ModelsApi } from './useModels'
import type { CurveEditingApi } from './useCurveEditing'
import type { InequalitySystemApi } from './useInequalitySystem'
import type { BoardOverlaysApi } from './useBoardOverlays'
import type { DomainPanelApi } from './useDomainPanel'
import type { BoardLookApi } from './useBoardLook'
import type { ShapesApi } from './useShapes'
import { measureAnswerParts } from '../ui/shapeMeasure'
import { shapeKey } from '../ui/reveal'
import { residualPlotReg } from '../ui/dataLinks'
import { residFigId } from '../ui/residualLinks'

/** What useRevealMode reads from the hooks App calls before it. */
export interface RevealModeDeps {
  board: BoardStateApi
  docState: DocumentStateApi
  session: SessionStateApi
  derived: ModelsApi
  editing: CurveEditingApi
  system: InequalitySystemApi
  overlaysApi: BoardOverlaysApi
  panel: DomainPanelApi
  lookApi: BoardLookApi
  /** The shapes' compiled geometry, for their measurement answers. Optional: tests may omit it. */
  shapesApi?: ShapesApi
}

export function useRevealMode({ board, docState, session, derived, editing, system, overlaysApi, panel, lookApi, shapesApi }: RevealModeDeps) {
  const {
    curves, kind, items, selectedId, calcLinks, fields, sequences, unitCircles, relatedRates, stats, shapes,
    dataSets, valueTables,
  } = board
  const shapeCompiled = shapesApi?.shapeCompiled
  const { docMeta } = docState
  const { reveal, setReveal, revealRef, revealByDocRef, revealFreshRef } = session
  const { models, depKeys, analysis, analysisFor, contextAnalysis } = derived
  const { showNotice } = editing
  const { sysCard } = system
  const { contextAnalysisRef } = overlaysApi
  const { domainPanel } = panel
  const { crossings } = lookApi

  /**
   * What each card lists, named the way the caption names the curves: the
   * board's derived letters (f, g, f′) when it has them, and otherwise the
   * card's own label, which is what a curve is called in every other sentence
   * this app writes about it.
   */
  // ------------------------------------------------------------ reveal mode
  //
  // Every answer the board and the cards state, keyed and in teaching order
  // (src/ui/reveal.ts). Built only while reveal mode is on: off, the board
  // pays nothing for it and every scene is the one it always was.
  const revealInv = useMemo<RevealInventory | null>(() => {
    if (!reveal.on) return null
    if (kind === 'number-line') {
      return buildInventory({
        curves: [],
        crossings: [],
        after: items.filter((it) => it.kind === 'solve').map((it) => solveKey(it.id)),
      })
    }
    const shown = curves.filter((c) => c.visible)
    const after: string[] = []
    for (const q of sequences) if (q.series && q.visible) after.push(seriesKey(q.id))
    for (const f of fields) if (f.eulers && f.eulers.length > 0) after.push(eulerKey(f.id))
    for (const u of unitCircles) if (u.hidden !== true) after.push(ucKey(u.id))
    for (const r of relatedRates) if (r.hidden !== true) after.push(rrKey(r.id))
    for (const st of stats) if (st.hidden !== true) after.push(statKey(st.id))
    // a residual plot's verdict (and the table card's r in words)
    const curveIds = new Set(curves.map((c) => c.id))
    for (const d of dataSets) if (d.visible && residualPlotReg(d, curveIds)) after.push(statKey(residFigId(d.id)))
    if (sysCard?.lp) after.push(SYSTEM_KEY)
    for (const s of shapes) {
      if (!s.visible) continue
      const c = shapeCompiled?.get(s.id)
      if (!c?.shape) continue
      // a transformation's image is the answer to "find the image"
      if (s.xform) after.push(shapeKey(s.id, 'image'))
      if (s.measure) for (const part of measureAnswerParts(c.shape.kind, s.measure, c.reports)) after.push(shapeKey(s.id, part))
      if (s.sym && c.sym) after.push(shapeKey(s.id, 'symmetry'))
    }
    return buildInventory({
      curves: shown.map((c) => {
        let asymptotes = 0
        if (c.id === selectedId) {
          try {
            asymptotes = asymptoteTexts(c, models).length
          } catch {
            asymptotes = 0
          }
        }
        return {
          id: c.id,
          // The analyzer's points are the answers; the selected curve's extra
          // construction marks (a transformation's image points …) are not.
          points: c.id === selectedId ? analysis : analysisFor(c),
          asymptotes,
          domain: c.id === selectedId && domainPanel !== undefined,
          inverse: domainPanel?.role === 'function',
          calc: calcLinks.filter((l) => l.parentId === c.id).map((l) => l.id),
          // The Table section's answers, for a table the teacher set up.
          extra: c.kind === 'explicit' ? tableKeysOf(c.id, valueTables[c.id]) : [],
        }
      }),
      crossings,
      after,
    })
    // depKeys: a curve that calls another moves when it does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal.on, kind, items, curves, selectedId, models, analysis, analysisFor, domainPanel, calcLinks, crossings, sequences, fields, unitCircles, relatedRates, stats, sysCard, depKeys, shapes, shapeCompiled, dataSets, valueTables])
  const revealInvRef = useRef(revealInv)
  revealInvRef.current = revealInv

  /** Reveal one answer: its "?" and its pills go, and the board rings it. */
  const revealKey = useCallback((key: string): void => {
    const now = performance.now()
    const fresh = revealFreshRef.current
    for (const [k, t] of fresh) if (now - t > 2000) fresh.delete(k)
    fresh.set(key, now)
    setReveal((s) => revealOne(s, key))
  }, [])
  const revealStep = useCallback(
    (dir: 'next' | 'back'): void => {
      const s = revealRef.current
      if (!s.on) return
      if (dir === 'back') {
        setReveal(hideLast(s))
        return
      }
      const r = revealNext(s, revealInvRef.current?.order ?? [])
      if (r.key === null) {
        showNotice('Every answer is showing')
        return
      }
      revealKey(r.key)
    },
    // showNotice is stable; named for the linter
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revealKey],
  )
  const revealEverything = useCallback((): void => {
    setReveal((s) => revealAll(s, revealInvRef.current?.order ?? []))
  }, [])
  const hideEverything = useCallback((): void => {
    revealFreshRef.current.clear()
    setReveal((s) => hideAll(s))
  }, [])
  const toggleReveal = useCallback((): void => {
    setReveal((s) => (s.on ? { ...s, on: false } : { ...hideAll(s), on: true }))
  }, [])
  const toggleRevealPositions = useCallback((): void => {
    setReveal((s) => ({ ...s, positions: !s.positions }))
  }, [])

  // One reveal state per document, for the session: switching documents puts
  // this one's away and brings the other's back as it was left.
  const revealDocIdRef = useRef(docMeta.id)
  useEffect(() => {
    const prev = revealDocIdRef.current
    if (prev === docMeta.id) return
    revealByDocRef.current.set(prev, revealRef.current)
    revealDocIdRef.current = docMeta.id
    revealFreshRef.current.clear()
    setReveal(revealByDocRef.current.get(docMeta.id) ?? REVEAL_OFF)
  }, [docMeta.id])

  /** The board's filter: what hides, and the "?" that stands in for it. */
  const sceneReveal = useMemo<SceneReveal | null>(() => {
    if (!reveal.on || !revealInv) return null
    return {
      hidden: (k: string) => isHidden(reveal, k),
      positions: reveal.positions,
      pointKey: revealInv.answerKey,
      crossKey: revealInv.crossKey,
      context: contextAnalysis,
      fresh: revealFreshRef.current,
      nlMarks: (id: string) => {
        const it = items.find((i) => i.id === id)
        if (!it || it.kind !== 'solve') return []
        const res = solveCached(it.src)
        return res.ok ? solveXs(res) : []
      },
    }
  }, [reveal, revealInv, contextAnalysis, items])
  const sceneRevealRef = useRef(sceneReveal)
  sceneRevealRef.current = sceneReveal

  /**
   * The other curves' markers on their own layer — none in reveal mode, where
   * the scene draws them itself, labelled, with "?" for the hidden ones
   * (applyReveal), so a revealed answer says what it is.
   */
  const contextShown = sceneReveal ? EMPTY_CONTEXT : contextAnalysis

  /** What the cards read: the same state, through one context. */
  const revealApi = useMemo<RevealApi>(
    () =>
      reveal.on && revealInv
        ? {
            on: true,
            hidden: (k: string) => isHidden(reveal, k),
            reveal: revealKey,
            pointKey: revealInv.pointKey,
            crossKey: revealInv.crossKey,
          }
        : REVEAL_API_OFF,
    [reveal, revealInv, revealKey],
  )
  // The export draws the other curves' markers as the board does: in reveal
  // mode, without the hidden ones (their "?" are in the scene).
  contextAnalysisRef.current = contextShown

  const revealCounts = useMemo(
    () => (revealInv ? revealCount(reveal, revealInv.order) : { hidden: 0, total: 0 }),
    [reveal, revealInv],
  )
  const revealControls: RevealControlsProps = {
    on: reveal.on,
    hidden: revealCounts.hidden,
    total: revealCounts.total,
    positions: reveal.positions,
    onToggle: toggleReveal,
    onNext: () => revealStep('next'),
    onAll: revealEverything,
    onReset: hideEverything,
    onPositions: toggleRevealPositions,
  }

  return {
    revealKey, revealStep, toggleReveal, sceneReveal, sceneRevealRef, contextShown, revealApi,
    revealControls,
  }
}

export type RevealModeApi = ReturnType<typeof useRevealMode>

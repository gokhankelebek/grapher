// ============================================================================
// src/app/useCurveNames.ts — who is who on the board: letters, inverses kept current, sign charts.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useEffect, useMemo, useRef } from 'react'
import { curveNames } from '../render/curveNames'
import { signBandHeight } from '../render/signChart'
import type { SignChartFigure } from '../render/signChart'
import {
  awaitedLetters,
  callableNames,
  inverseInfo,
  lineErrors,
  nextFreeLetter,
  sliderLetters,
} from '../ui/nameLinks'
import type { InverseInfo } from '../ui/nameLinks'
import { presentScale } from '../ui/present'
import { sequenceLetters } from '../ui/seqLinks'
import { signChartFigures } from '../ui/signChartLinks'
import type { SignChartLink } from '../ui/signChartLinks'
import { withTaylorNames } from '../ui/taylorLinks'
import type { BoardStateApi } from './useBoardState'
import type { DocumentStateApi } from './useDocumentState'
import type { SessionStateApi } from './useSessionState'
import type { BoardRefsApi } from './useBoardRefs'
import type { ModelsApi } from './useModels'
import type { HistoryApi } from './useHistory'
import type { BoardOverlaysApi } from './useBoardOverlays'

/** What useCurveNames reads from the hooks App calls before it. */
export interface CurveNamesDeps {
  board: BoardStateApi
  docState: DocumentStateApi
  session: SessionStateApi
  refs: BoardRefsApi
  derived: ModelsApi
  history: HistoryApi
  overlaysApi: BoardOverlaysApi
}

export function useCurveNames({ board, docState, session, refs, derived, history, overlaysApi }: CurveNamesDeps) {
  const { curves, kind, calcLinks, sequences } = board
  const { exprSources, displaySources, names, calls, inverses } = docState
  const { presentMode, presentType } = session
  const { curvesRef, inversesRef, boardCurveNamesRef } = refs
  const { models, inverseInfoRef, depKeys } = derived
  const { applyState } = history
  const { hasSignCharts, signSpan } = overlaysApi

  // ------------------------------------------------------- who is who on the board
  //
  // "Graph of f" is true of a board with one curve and a lie about a board
  // with three: it names a function nothing on the figure points at, and the
  // printed sheet gives a student no way to tell which stroke is f. So the
  // board names its curves — f, g, h …, a typed `g(x) = …` keeping the letter
  // it was given, a derivative keeping its parent's letter and a prime — and
  // the caption and the labels on the figure both read from that ONE map.
  //
  // The letters are STORED (src/ui/nameLinks.ts) — a line that says f(x − 1)
  // needs f to stay f — and this reads them, adding only what a letter cannot
  // say: f′ for a derivative, f⁻¹ for an inverse, nothing for a tangent.
  const boardCurveNames = useMemo(
    () =>
      kind === 'cartesian'
        ? withTaylorNames(
            curveNames(curves, { ...displaySources, ...exprSources }, calcLinks, names, inverses),
            calcLinks,
            new Set(curves.filter((c) => c.visible).map((c) => c.id)),
          )
        : {},
    [kind, curves, displaySources, exprSources, calcLinks, names, inverses],
  )
  /** What each CARD is called — hidden curves included, which a caption leaves out. */
  const cardNames = useMemo(
    () =>
      withTaylorNames(
        curveNames(
          curves.map((c) => (c.visible ? c : { ...c, visible: true })),
          { ...displaySources, ...exprSources },
          calcLinks,
          names,
          inverses,
        ),
        calcLinks,
        new Set(curves.map((c) => c.id)),
      ),
    [curves, displaySources, exprSources, calcLinks, names, inverses],
  )
  /**
   * The letters a card may rename. A Taylor curve is called Pₙ by its degree,
   * not by a letter the teacher chose, so its chip is not a rename field.
   */
  const renamableNames = useMemo(() => {
    const tay = calcLinks.filter((l) => l.kind === 'taylor')
    if (tay.length === 0) return names
    const out = { ...names }
    for (const l of tay) if (l.kind === 'taylor') delete out[l.curveId]
    return out
  }, [names, calcLinks])
  /** Why a typed line that calls another curve can't be drawn, per curve. */
  const linkErrors = useMemo(
    () => lineErrors({ curves, names, calls, models }),
    [curves, names, calls, models],
  )
  /** Letters curves already hold — the piecewise builder says so when its name takes one. */
  const takenNames = useMemo(() => Object.values(names), [names])
  /** The piecewise builder's first name: the next free letter, as a new curve would get. */
  const piecewiseName = useMemo(
    () =>
      nextFreeLetter(
        new Set(Object.values(names)),
        new Set([
          ...awaitedLetters(calls),
          ...sliderLetters(curves, exprSources, models),
          ...sequenceLetters(sequences),
        ]),
      ) ?? '',
    [names, calls, curves, exprSources, models, sequences],
  )
  /** The letters the equation box offers as chips. */
  const exprNames = useMemo(
    () => (kind === 'cartesian' ? callableNames(curves, names) : []),
    [kind, curves, names],
  )

  // ------------------------------------------------ inverses, kept current
  //
  // The inverse curve's model reads its parent live, so it follows a drag on
  // its own. What has to be re-asked when the parent changes is the
  // horizontal line test — the card's sentence — and the stretch of t it is
  // drawn over. Cached per link on the parent's state.
  const inverseCacheRef = useRef(new Map<string, { key: string; info: InverseInfo }>())
  const inverseInfos = useMemo<Record<string, InverseInfo>>(() => {
    const out: Record<string, InverseInfo> = {}
    for (const l of inverses) {
      const parent = curves.find((c) => c.id === l.parentId)
      if (!parent) continue
      const name = names[l.parentId] ?? 'f'
      const range: [number, number] = parent.domain
        ? [Math.min(...parent.domain), Math.max(...parent.domain)]
        : [l.from, l.to]
      const key = `${parent.modelId}|${parent.params.join(',')}|${range.join(',')}|${
        depKeys[parent.id] ?? ''
      }|${name}|${models[parent.modelId] ? 1 : 0}`
      const hit = inverseCacheRef.current.get(l.id)
      if (hit && hit.key === key) {
        out[l.id] = hit.info
        continue
      }
      try {
        const info = inverseInfo(parent, models, { from: range[0], to: range[1] }, name)
        inverseCacheRef.current.set(l.id, { key, info })
        out[l.id] = info
      } catch {
        /* no facts to state this frame */
      }
    }
    return out
  }, [inverses, curves, names, depKeys, models])
  inverseInfoRef.current = inverseInfos

  // The inverse curve's t-range follows its parent's (a sketch's ends
  // dragged). Never pushes history: it is the consequence of that drag.
  useEffect(() => {
    const links = inversesRef.current
    if (links.length === 0) return
    const before = curvesRef.current
    let changed = false
    const after = before.map((c) => {
      const l = links.find((k) => k.curveId === c.id)
      const info = l ? inverseInfos[l.id] : undefined
      if (!info || String(c.domain) === String(info.tRange)) return c
      changed = true
      return { ...c, domain: info.tRange }
    })
    if (changed) applyState({ curves: after })
  }, [inverseInfos, applyState])

  /** The card note an inverse curve wears: the horizontal line test. */
  const inverseNotes = useMemo(() => {
    const out: Record<string, string> = {}
    for (const l of inverses) {
      const info = inverseInfos[l.id]
      if (info) out[l.curveId] = info.sentence
    }
    return out
  }, [inverses, inverseInfos])
  boardCurveNamesRef.current = boardCurveNames

  /**
   * The sign charts' strips along the bottom of the board — figure content:
   * the screen and every export draw the same list (BoardScene.signCharts).
   * Keyed on depKeys, so a chart on a line that calls f follows f.
   */
  const signFigures = useMemo<SignChartFigure[]>(() => {
    if (kind !== 'cartesian' || !hasSignCharts) return []
    const links = calcLinks.filter((l): l is SignChartLink => l.kind === 'signchart')
    try {
      return signChartFigures(links, curves, models, { ...cardNames, ...boardCurveNames }, depKeys, signSpan)
    } catch {
      return []
    }
  }, [kind, hasSignCharts, calcLinks, curves, models, cardNames, boardCurveNames, depKeys, signSpan])
  const signFiguresRef = useRef<SignChartFigure[]>(signFigures)
  /** CSS px the sign-chart band takes along the bottom of the board (0: none). */
  const signBandPx = useMemo(
    () => (kind === 'cartesian' ? signBandHeight(signFigures, presentMode ? presentScale(presentType) : null) : 0),
    [kind, signFigures, presentMode, presentType],
  )
  signFiguresRef.current = signFigures

  return {
    boardCurveNames, cardNames, renamableNames, linkErrors, takenNames, piecewiseName, exprNames,
    inverseNotes, signFigures, signFiguresRef, signBandPx,
  }
}

export type CurveNamesApi = ReturnType<typeof useCurveNames>

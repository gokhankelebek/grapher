// ============================================================================
// src/app/useBoardLook.ts — the caption, the screen look, and where the curves meet.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useMemo, useRef } from 'react'
import { DARK_THEME, LIGHT_THEME } from '../core/types'
import { namesInOrder } from '../render/curveNames'
import { defaultCaption, screenLook } from '../ui/figureStyle'
import { CROSSINGS_THROTTLE, GestureThrottle, timed, useGestureKey } from '../ui/gestureThrottle'
import {
  boardMeetings,
  crossingsClearOf,
  intersectionKey,
  taylorApart,
} from '../ui/intersections'
import type { BoardCoincidence, BoardIntersection } from '../ui/intersections'
import { curveSpecSerial } from '../ui/valueKeys'
import { EMPTY_ANALYSIS, EMPTY_CROSSINGS } from './constants'

/** No meetings: one object, so a memo downstream sees the same value. */
const EMPTY_MEETINGS: { points: BoardIntersection[]; coincide: BoardCoincidence[] } = { points: [], coincide: [] }
import type { BoardStateApi } from './useBoardState'
import type { SessionStateApi } from './useSessionState'
import type { BoardRefsApi } from './useBoardRefs'
import type { ModelsApi } from './useModels'
import type { CalcLinksApi } from './useCalcLinks'
import type { SelectionMarksApi } from './useSelectionMarks'
import type { CurveNamesApi } from './useCurveNames'

/** What useBoardLook reads from the hooks App calls before it. */
export interface BoardLookDeps {
  board: BoardStateApi
  session: SessionStateApi
  refs: BoardRefsApi
  derived: ModelsApi
  calc: CalcLinksApi
  marks: SelectionMarksApi
  naming: CurveNamesApi
}

export function useBoardLook({ board, session, refs, derived, calc, marks, naming }: BoardLookDeps) {
  const { curves, kind, calcLinks, figureStyle, figureCaption, previewFigure } = board
  const { markersOn, canvasTheme, presentMode } = session
  const { gesturing } = refs
  const { models, selectedCurve, depKeys } = derived
  const { crossSpan } = calc
  const { boardAnalysis } = marks
  const { boardCurveNames } = naming

  /** The caption the board would write for itself, right now. */
  const autoCaption = defaultCaption(figureStyle, namesInOrder(curves, boardCurveNames))
  /**
   * The caption that actually gets printed: the teacher's own words when they
   * have written any, and otherwise the one the board keeps re-deriving.
   */
  const captionText = figureCaption ?? autoCaption
  const captionTextRef = useRef(captionText)
  captionTextRef.current = captionText
  const autoCaptionRef = useRef(autoCaption)
  autoCaptionRef.current = autoCaption

  /** The ground the theme toggle asks for. */
  const screenTheme = canvasTheme === 'light' ? LIGHT_THEME : DARK_THEME
  /**
   * What the board on SCREEN draws — and, since there is one canvas, what the
   * PRESENTED board draws too.
   *
   * The chosen figure style is not in it. A style says what the PNG and the
   * clipboard copy come out looking like; the working board keeps the theme,
   * and presentation mode keeps it whatever the preview switch says, because a
   * presented board is a lit wall and an SAT figure on it is a white rectangle
   * in a dark room. See screenLook / exportLook in ui/figureStyle.ts — two
   * destinations, two answers, so the board cannot quietly pick up the
   * export's ground the way it did before.
   */
  const look = screenLook({
    style: figureStyle,
    caption: captionText,
    screenTheme,
    preview: previewFigure,
    present: presentMode,
    cartesian: kind === 'cartesian',
  })
  const boardFigure = look.figure
  const boardCaption = look.caption
  const boardTheme = look.theme
  /**
   * Whether the toolbar has to read against a LIGHT canvas. A PREVIEW puts the
   * board on white whatever the theme toggle says, and the chrome around it has
   * to follow or it is grey-on-grey.
   */
  const lightBoard = canvasTheme === 'light' || look.previewing

  // ------------------------------------------------- where the curves meet
  //
  // The one analysis point that does not belong to a curve. It is computed for
  // the BOARD rather than for the selection, once per pair, because a crossing
  // has two parents: it is drawn once (a neutral diamond, neither curve's
  // colour) and listed on both cards, from this single list, so the two can
  // never print different answers to "where do f and g cross?".
  //
  // They are computed whether or not the markers are switched on, for the same
  // reason analyzeCurve is: the CARDS state them, and a card's analysis table
  // does not come and go with the board's toggle. What the toggle governs is
  // the BOARD — see the scene below, where the screen look is handed the list
  // only while Analysis is on, exactly as every other marker is.
  //
  // A MARKED figure is the exception, and deliberately: a textbook figure of
  // two graphs is a figure about where they meet, and a PNG that dropped the
  // crossings would be the bug the analysis layer once had, in a new place.
  const markedBoard = boardFigure != null && boardFigure.curveEnds === 'marked'
  const crossingsOn = kind === 'cartesian'

  /**
   * The key the pair solve is memoised on: the curves that can be crossed,
   * their params and domains, and the coarse range — never the identity of the
   * curve array, which a slider drag rebuilds on every frame with the same
   * numbers in it.
   */
  //
  // Each curve's model IDENTITY is in the key (not the `models` map, which is
  // rebuilt whenever any model is re-registered), and while a gesture is in
  // progress the key is throttled by the solve's own cost — see
  // src/ui/gestureThrottle.ts. On release the live key goes straight through.
  const crossKeyLive = crossingsOn
    ? intersectionKey(curves, crossSpan, depKeys, (c) => curveSpecSerial(c, models))
    : ''
  const crossThrottle = useRef(new GestureThrottle(CROSSINGS_THROTTLE)).current
  const crossKey = useGestureKey(crossKeyLive, gesturing, crossThrottle)
  // a curve and its own Taylor polynomial are never solved as a pair
  const crossApart = useMemo(() => taylorApart(calcLinks), [calcLinks])
  const curvesForCross = useRef(curves)
  curvesForCross.current = curves
  const modelsForCross = useRef(models)
  modelsForCross.current = models

  const meetings = useMemo<{ points: BoardIntersection[]; coincide: BoardCoincidence[] }>(() => {
    if (!crossingsOn) return EMPTY_MEETINGS
    const found = timed(crossThrottle, () =>
      boardMeetings(curvesForCross.current, modelsForCross.current, crossSpan, crossApart),
    )
    return found.points.length > 0 || found.coincide.length > 0 ? found : EMPTY_MEETINGS
    // The curve list and the models are tracked through crossKey, not identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crossingsOn, crossKey, crossSpan, crossApart])
  const crossings = meetings.points.length > 0 ? meetings.points : EMPTY_CROSSINGS
  /** Pairs of curves that are the same curve (everywhere, or on an interval): stated on the cards. */
  const coincidences = meetings.coincide
  const crossingsRef = useRef(crossings)
  crossingsRef.current = crossings

  /**
   * The crossings the BOARD draws: the same list, less any crossing standing
   * exactly where the selected curve's own marker is (a circle's lowest point
   * that the parabola touches, a vertex a line goes through). There the
   * analysis marker keeps its chip and the crossing yields, so one place is
   * one chip — see crossingsClearOf. The cards still read `crossings`.
   */
  const boardCrossings = useMemo<readonly BoardIntersection[]>(() => {
    if (!(markersOn || markedBoard)) return EMPTY_CROSSINGS
    const marks = selectedCurve && selectedCurve.visible ? boardAnalysis : EMPTY_ANALYSIS
    return crossingsClearOf(crossings, marks, crossSpan)
  }, [markersOn, markedBoard, selectedCurve, boardAnalysis, crossings, crossSpan])

  return {
    captionText, captionTextRef, autoCaptionRef, screenTheme, look, boardFigure, boardCaption,
    boardTheme, lightBoard, crossings, crossingsRef, boardCrossings, coincidences,
  }
}

export type BoardLookApi = ReturnType<typeof useBoardLook>

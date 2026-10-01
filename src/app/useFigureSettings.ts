// ============================================================================
// src/app/useFigureSettings.ts — axis units, the ruling, the figure style, the caption and the theme.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useCallback, useEffect, useMemo } from 'react'
import { resolveAxisUnits } from '../core/persist'
import type { AxisUnitChoice, BoardGrid } from '../core/persist'
import { FIGURE_STYLES } from '../core/types'
import type { FigureStyleId } from '../core/types'
import { POLAR_OFFER, suggestPolarRuling } from '../ui/boardGrid'
import { updatePrefs } from '../ui/storage'
import { POLAR_NEEDS_EQUAL, rulingRefused, squareAxes } from '../ui/viewScale'
import { CAPTION_LABEL } from './constants'
import type { BoardStateApi } from './useBoardState'
import type { DocumentStateApi } from './useDocumentState'
import type { SessionStateApi } from './useSessionState'
import type { BoardRefsApi } from './useBoardRefs'
import type { ModelsApi } from './useModels'
import type { NoticesApi } from './useNotices'
import type { HistoryApi } from './useHistory'
import type { ViewportApi } from './useViewport'
import type { BoardLookApi } from './useBoardLook'

/** What useFigureSettings reads from the hooks App calls before it. */
export interface FigureSettingsDeps {
  board: BoardStateApi
  docState: DocumentStateApi
  session: SessionStateApi
  refs: BoardRefsApi
  derived: ModelsApi
  notices: NoticesApi
  history: HistoryApi
  viewport: ViewportApi
  lookApi: BoardLookApi
}

export function useFigureSettings({ board, docState, session, refs, derived, notices, history, viewport, lookApi }: FigureSettingsDeps) {
  const { curves, kind, setBoardGrid, setFigureCaption, setPreviewFigure } = board
  const { shared } = docState
  const { setCanvasTheme, setAxisUnitChoice } = session
  const {
    kindRef, undoRef, redoRef, axisUnitChoiceRef, boardGridRef, figureStyleRef, figureCaptionRef,
    polarOfferedRef,
  } = refs
  const { suggestedXRef, vpRef } = derived
  const { showToast } = notices
  const { commitState } = history
  const { viewMoved } = viewport
  const { autoCaptionRef } = lookApi

  /** State one axis. Idempotent — pressing the on segment again changes nothing. */
  const setAxisUnit = useCallback((axis: 'x' | 'y', choice: AxisUnitChoice): void => {
    setAxisUnitChoice((prev) => (prev[axis] === choice ? prev : { ...prev, [axis]: choice }))
  }, [])

  /**
   * Put the board on a ruling.
   *
   * Not in the undo history, exactly as the axis units are not: it is how the
   * board is MEASURED, not a thing on it. Choosing one also settles the
   * question for this document — the offer below never comes back.
   */
  const setRuling = useCallback(
    (next: BoardGrid): void => {
      polarOfferedRef.current = true
      // Circles of constant r are only circles on equal axes. A stretched
      // board is REFUSED rather than silently re-squared: re-squaring throws
      // away a window the teacher set on purpose. One tap does both.
      if (rulingRefused(next, vpRef.current)) {
        showToast(POLAR_NEEDS_EQUAL, {
          ms: 7000,
          action: {
            label: 'Make axes equal',
            run: () => {
              squareAxes(vpRef.current)
              setBoardGrid('polar')
              viewMoved()
            },
          },
        })
        return
      }
      setBoardGrid((prev) => (prev === next ? prev : next))
    },
    [showToast, viewMoved],
  )

  /**
   * Put the board in a figure style.
   *
   * ONE undo entry, named after the style — unlike the ruling, which stays out
   * of the history because it is a way of MEASURING the board. A style repaints
   * the whole figure, and the change a teacher is most likely to want back is
   * the one they made by clicking a picture they had not seen full size yet.
   *
   * The caption is no longer copied into this entry, because it is no longer
   * a constant handed over at the moment a style is picked: while it is AUTO
   * it is derived from the style and the curves together, so choosing AP makes
   * the board write "Graphs of f and g" by itself and choosing Screen makes it
   * write nothing — with one undo, of the style, which is the change that was
   * made. A caption the teacher wrote is theirs and is not touched either way.
   */
  const chooseFigureStyle = useCallback(
    (next: FigureStyleId): void => {
      if (figureStyleRef.current === next) return
      // Back to Screen is back to no style at all, so there is nothing left to
      // preview: leaving the switch armed would mean the next style chosen
      // silently repainted the board.
      if (next === 'screen') setPreviewFigure(false)
      commitState({ figure: next }, `figure style: ${FIGURE_STYLES[next].name}`)
    },
    [commitState],
  )

  /**
   * The caption, as it is typed.
   *
   * One undo entry per RUN of typing rather than per keystroke: consecutive
   * caption edits fold into the entry already on top of the stack, and anything
   * else the teacher does closes the run. Undo then takes back "the caption I
   * just wrote", which is the unit anybody means.
   */
  const setCaption = useCallback(
    (next: string): void => {
      // Typing the board's own sentence back is not an override: it leaves the
      // caption following the curves, which is what it was already doing and
      // what "↺ auto" would put it back to.
      const value: string | null = next === autoCaptionRef.current ? null : next
      if (figureCaptionRef.current === value) return
      const top = undoRef.current[undoRef.current.length - 1]
      if (top?.label === CAPTION_LABEL) {
        redoRef.current = []
        figureCaptionRef.current = value
        setFigureCaption(value)
        return
      }
      commitState({ caption: value }, CAPTION_LABEL)
    },
    [commitState],
  )

  /**
   * Hand the caption back to the board.
   *
   * One undo entry of its own, not folded into a run of typing: it undoes a
   * click, and the words it takes back are the ones the teacher wrote.
   */
  const resetCaption = useCallback((): void => {
    if (figureCaptionRef.current === null) return
    commitState({ caption: null }, 'caption follows the board')
  }, [commitState])

  /**
   * A polar curve has just landed on a square board. OFFER the polar ruling.
   *
   * Deliberately not the axis-units mechanism, which re-rules the board by
   * itself when 'auto' sees a sine. Re-drawing every gridline under a class
   * mid-lesson is a much larger surprise than re-labelling an axis, and it is
   * a surprise in both directions — deleting the rose would have to put the
   * squares back, in the middle of whatever came next. So it is one line at
   * the foot of the board with one tap to accept, asked once per document,
   * and ignoring it IS declining it.
   */
  const wantsPolar = useMemo(
    () => (kind === 'cartesian' ? suggestPolarRuling(curves) : false),
    [kind, curves],
  )
  const viewOnlyNow = shared?.viewOnly === true
  useEffect(() => {
    if (!wantsPolar || polarOfferedRef.current) return
    // A view-only share is a student's: the offer's one tap re-rules the
    // board, which is an edit — and on a phone it sat over the graph for nine
    // seconds as six lines of text. Not offered, and not used up: a copy the
    // student makes is theirs to be asked about.
    if (viewOnlyNow) return
    if (boardGridRef.current === 'polar') {
      polarOfferedRef.current = true
      return
    }
    polarOfferedRef.current = true
    showToast(POLAR_OFFER, {
      ms: 9000,
      action: { label: 'Polar ruling', run: () => setRuling('polar') },
    })
  }, [wantsPolar, viewOnlyNow, showToast, setRuling])

  /**
   * Shift+P: the x-axis, round the three states, with the answer said out loud.
   *
   * A cycle rather than a toggle because 'auto' is a state a teacher has to be
   * able to get BACK to, and the shortcut is the only place the control is not
   * on screen. The toast is what makes a three-way key learnable: it names the
   * state it just landed on, including whether the board is deciding.
   */
  const cycleAxisUnitX = useCallback((): void => {
    if (kindRef.current !== 'cartesian') return
    const order: AxisUnitChoice[] = ['auto', 'pi', 'decimal']
    const cur = axisUnitChoiceRef.current.x
    const next = order[(order.indexOf(cur) + 1) % order.length]
    setAxisUnitChoice((prev) => ({ ...prev, x: next }))
    const shown = resolveAxisUnits({ x: next, y: axisUnitChoiceRef.current.y }, {
      x: suggestedXRef.current,
    }).x
    showToast(
      `x axis in ${shown === 'pi' ? 'multiples of π' : 'decimals'}${next === 'auto' ? ' (auto)' : ''}`,
      { ms: 2200 },
    )
  }, [showToast])

  const toggleCanvasTheme = useCallback((): void => {
    setCanvasTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark'
      updatePrefs({ canvasTheme: next })
      return next
    })
  }, [])

  return {
    setAxisUnit, setRuling, chooseFigureStyle, setCaption, resetCaption, cycleAxisUnitX,
    toggleCanvasTheme,
  }
}

export type FigureSettingsApi = ReturnType<typeof useFigureSettings>

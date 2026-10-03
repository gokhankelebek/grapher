// ============================================================================
// src/app/useGraphDescription.ts — the board in words (screen readers, alt
// text, the "Describe this graph" panel).
//
// The description is made from the document as it would be saved — the same
// path "Copy for item bank…" takes (useItemBank) — through describeBoard
// (src/ui/boardDescription.ts). It is recomputed a moment after the board
// stops changing (curves, links, the view), never on every frame of a drag:
// a screen reader is told about the curve that landed, not every pixel of it.
//
// Reveal mode decides what is said: while it is on, the description is the
// student copy (no computed answers), exactly as the board hides them.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { docFromBoard, serializeDoc } from '../core/persist'
import { docModelFromJSON } from '../ui/docScene'
import { clampFitSettings } from '../ui/exportFit'
import type { BoardDescription } from '../ui/boardDescription'
import { describeBoard } from '../ui/boardDescription'
import type { BoardStateApi } from './useBoardState'
import type { SessionStateApi } from './useSessionState'
import type { BoardRefsApi } from './useBoardRefs'
import type { ModelsApi } from './useModels'
import type { NoticesApi } from './useNotices'
import type { DocumentPersistenceApi } from './useDocumentPersistence'
import type { BoardOverlaysApi } from './useBoardOverlays'

/** The id of the visually hidden long description the board points at. */
export const BOARD_DESC_ID = 'board-description'

/** How long the board must be still before it is described again. */
export const DESCRIBE_DEBOUNCE_MS = 600
/** …but never longer than this after the first change. */
export const DESCRIBE_MAX_WAIT_MS = 2000

export interface GraphDescriptionDeps {
  board: BoardStateApi
  session: SessionStateApi
  refs: BoardRefsApi
  derived: ModelsApi
  notices: NoticesApi
  persistence: DocumentPersistenceApi
  overlaysApi: BoardOverlaysApi
}

const START: BoardDescription = { summary: 'Graph', figuredesc: 'Graph.', long: '' }

export function useGraphDescription({ board, session, refs, derived, notices, persistence, overlaysApi }: GraphDescriptionDeps) {
  const {
    curves, items, kind, fields, shapes, dataSets, sequences, calcLinks, unitCircles, relatedRates,
    historyTick, viewSubsRef, stats,
  } = board
  const { reveal, curvePalette } = session
  const { docMetaRef } = refs
  const { vpRef } = derived
  const { showToast } = notices
  const { currentBoardInput } = persistence
  const { exportSettingsRef } = overlaysApi

  const answers = !reveal.on
  const answersRef = useRef(answers)
  answersRef.current = answers
  const paletteRef = useRef(curvePalette)
  paletteRef.current = curvePalette

  /** The board described now (synchronously) — for an export, a copy, the panel. */
  const describeNow = useCallback((): BoardDescription => {
    try {
      const json = serializeDoc(docFromBoard(docMetaRef.current, currentBoardInput()))
      const vp = vpRef.current
      const model = docModelFromJSON(json, {
        screen: { widthPx: vp.widthPx, heightPx: vp.heightPx },
        settings: clampFitSettings(exportSettingsRef.current),
      })
      return model ? describeBoard(model, { answers: answersRef.current, palette: paletteRef.current }) : START
    } catch {
      return START
    }
  }, [currentBoardInput])

  const [description, setDescription] = useState<BoardDescription>(START)
  const timerRef = useRef(0)
  const describeNowRef = useRef(describeNow)
  describeNowRef.current = describeNow

  /** When the oldest change still waiting to be described happened (0: none waiting). */
  const firstPendingRef = useRef(0)
  const schedule = useCallback((): void => {
    window.clearTimeout(timerRef.current)
    const now = Date.now()
    if (!firstPendingRef.current) firstPendingRef.current = now
    // A board that never stops changing (Play running) is still described,
    // at most every DESCRIBE_MAX_WAIT_MS.
    const wait = Math.max(0, Math.min(DESCRIBE_DEBOUNCE_MS, firstPendingRef.current + DESCRIBE_MAX_WAIT_MS - now))
    timerRef.current = window.setTimeout(() => {
      firstPendingRef.current = 0
      const next = describeNowRef.current()
      setDescription((prev) =>
        prev.long === next.long && prev.summary === next.summary && prev.figuredesc === next.figuredesc ? prev : next,
      )
    }, wait)
  }, [])

  // Anything the figure is made of; the view arrives through its subscription.
  useEffect(() => {
    schedule()
  }, [
    schedule, curves, items, kind, fields, shapes, dataSets, sequences, calcLinks, unitCircles,
    relatedRates, historyTick, answers, curvePalette, stats,
  ])
  useEffect(() => {
    const subs = viewSubsRef.current
    const fn = (): void => schedule()
    subs.add(fn)
    return () => {
      subs.delete(fn)
    }
  }, [schedule, viewSubsRef])
  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  // ---- "Describe this graph" (⌘K, the help sheet, the toolbar's ⋯)
  const [describeOpen, setDescribeOpen] = useState(false)
  const openDescribe = useCallback((): void => {
    setDescription(describeNowRef.current())
    setDescribeOpen(true)
  }, [])
  const closeDescribe = useCallback((): void => setDescribeOpen(false), [])

  /** Put text on the clipboard and say so; false when the browser refused. */
  const copyText = useCallback(
    (text: string, what: string): Promise<boolean> => {
      if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
        showToast('Couldn’t copy — this browser has no clipboard access. Select the text and copy it instead.')
        return Promise.resolve(false)
      }
      return navigator.clipboard.writeText(text).then(
        () => {
          showToast(`Copied ${what}.`, { ms: 2200 })
          return true
        },
        () => {
          showToast('Couldn’t copy — the browser refused. Select the text and copy it instead.')
          return false
        },
      )
    },
    [showToast],
  )

  /** Download ▾ → Copy alt text: the one-line description, for an image's alt. */
  const copyAltText = useCallback((): Promise<boolean> => {
    const d = describeNowRef.current()
    return copyText(d.figuredesc, 'the alt text')
  }, [copyText])

  return {
    description, describeNow, describeOpen, openDescribe, closeDescribe, copyText, copyAltText,
  }
}

export type GraphDescriptionApi = ReturnType<typeof useGraphDescription>

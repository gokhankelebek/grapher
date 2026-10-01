// ============================================================================
// src/app/useNotices.ts — toasts and the feature-edit note.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useCallback } from 'react'
import type { BoardStateApi } from './useBoardState'
import type { SessionStateApi } from './useSessionState'
import type { BoardRefsApi } from './useBoardRefs'

/** What useNotices reads from the hooks App calls before it. */
export interface NoticesDeps {
  board: BoardStateApi
  session: SessionStateApi
  refs: BoardRefsApi
}

export function useNotices({ board, session, refs }: NoticesDeps) {
  const { setToast } = board
  const { featureNote, setFeatureNote, featureNoteTimerRef } = session
  const { toastTimerRef } = refs

  // ------------------------------------------------------------------ toasts
  /**
   * A brief, non-modal message at the foot of the board, optionally carrying
   * the ONE thing to do about it. Defined up here because undo and redo report
   * themselves through it.
   */
  const showToast = useCallback(
    (msg: string, opts?: { ms?: number; action?: { label: string; run(): void } }): void => {
      window.clearTimeout(toastTimerRef.current)
      setToast({ msg, key: Date.now(), ...(opts?.action ? { action: opts.action } : {}) })
      toastTimerRef.current = window.setTimeout(() => setToast(null), opts?.ms ?? 3600)
    },
    [],
  )

  /** Only one answer is on screen at a time — both reply to the last action. */
  const showFeatureNote = useCallback(
    (note: typeof featureNote): void => {
      window.clearTimeout(featureNoteTimerRef.current)
      window.clearTimeout(toastTimerRef.current)
      setToast(null)
      setFeatureNote(note)
      if (note && note.kind === 'moved') {
        featureNoteTimerRef.current = window.setTimeout(() => setFeatureNote(null), 5200)
      }
    },
    [],
  )

  return {
    showToast, showFeatureNote,
  }
}

export type NoticesApi = ReturnType<typeof useNotices>

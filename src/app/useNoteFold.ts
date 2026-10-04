// ============================================================================
// src/app/useNoteFold.ts — the teacher note's fold state, reveal mode included.
//
// Outside reveal mode the note is folded exactly when the teacher folded it
// (useExamples.foldedNotes, per document, for the session). While Reveal is
// on it folds by itself, because the note states the answers and a teacher
// projecting the sidebar would give them away; a deliberate "Show note" opens
// it for the rest of that reveal session. When Reveal turns off, the
// teacher's own choice is back, untouched (it was never written to).
//
// Called once per render by App (src/App.tsx), after useExamples and
// useSessionState.
// ============================================================================

import { useCallback, useEffect, useState } from 'react'
import { noteFoldedNow } from '../ui/TeacherNote'

export function useNoteFold(
  foldedNotes: ReadonlySet<string>,
  setNoteFolded: (docId: string, folded: boolean) => void,
  revealing: boolean,
) {
  /** Documents whose note the teacher unfolded on purpose during this reveal session. */
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set())
  // Each time Reveal turns on (or off), the note starts folded again next time.
  useEffect(() => {
    setOpened((prev) => (prev.size === 0 ? prev : new Set()))
  }, [revealing])

  const noteFolded = useCallback(
    (docId: string): boolean => noteFoldedNow(foldedNotes.has(docId), revealing, opened.has(docId)),
    [foldedNotes, revealing, opened],
  )

  const foldNote = useCallback(
    (docId: string, folded: boolean): void => {
      if (!revealing) {
        setNoteFolded(docId, folded)
        return
      }
      setOpened((prev) => {
        if (prev.has(docId) === !folded) return prev
        const next = new Set(prev)
        if (folded) next.delete(docId)
        else next.add(docId)
        return next
      })
    },
    [revealing, setNoteFolded],
  )

  return { noteFolded, foldNote }
}

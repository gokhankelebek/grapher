// ============================================================================
// src/app/useKeyboard.ts — the global keyboard shortcuts.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useEffect } from 'react'
import { revealKeyAction } from '../ui/reveal'
import { updatePrefs } from '../ui/storage'
import type { BoardStateApi } from './useBoardState'
import type { DocumentStateApi } from './useDocumentState'
import type { SessionStateApi } from './useSessionState'
import type { BoardRefsApi } from './useBoardRefs'
import type { HistoryApi } from './useHistory'
import type { CurveEditingApi } from './useCurveEditing'
import type { CalcLinksApi } from './useCalcLinks'
import type { RevealModeApi } from './useRevealMode'
import type { FigureSettingsApi } from './useFigureSettings'
import type { SidebarEditorsApi } from './useSidebarEditors'
import type { ViewportApi } from './useViewport'

/** What useKeyboard reads from the hooks App calls before it. */
export interface KeyboardDeps {
  board: BoardStateApi
  docState: DocumentStateApi
  session: SessionStateApi
  refs: BoardRefsApi
  history: HistoryApi
  editing: CurveEditingApi
  calc: CalcLinksApi
  revealMode: RevealModeApi
  figureSettings: FigureSettingsApi
  editors: SidebarEditorsApi
  viewport: ViewportApi
}

export function useKeyboard({ board, docState, session, refs, history, editing, calc, revealMode, figureSettings, editors, viewport }: KeyboardDeps) {
  const { setSidebarOpen, armedBetweenRef } = board
  const { sharedRef } = docState
  const { setShowAnalysis, revealRef, setPresentMode, setPalette, setHelpOpen } = session
  const { selectedRef } = refs
  const { undo, redo, commitWithSnap } = history
  const { nudgeSelected } = editing
  const { cancelBetween } = calc
  const { revealStep, toggleReveal } = revealMode
  const { cycleAxisUnitX } = figureSettings
  const { deleteSelection } = editors
  const { zoomBy } = viewport

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    const NUDGE: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, 1],
      ArrowDown: [0, -1],
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const meta = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      // The command palette (/) and the help sheet (?). Free keys: the board's
      // letters are A, F, R, ⇧P, \ and ⌘Z / ⌘Y (src/ui/commands.ts lists them).
      if (!meta && !e.altKey && (e.key === '/' || e.key === '?')) {
        e.preventDefault()
        if (e.key === '/') {
          setHelpOpen(false)
          setPalette({ key: Date.now() })
        } else {
          setPalette(null)
          setHelpOpen(true)
        }
        return
      }
      // Reveal mode first: R, and — while it is on — → / PageDown (next) and
      // ← / PageUp (back), which is what a presentation clicker sends. See
      // revealKeyAction for why these keys and not others.
      const ra = revealKeyAction(e, revealRef.current.on)
      // A student (view-only link in reveal mode) steps; R would turn reveal
      // mode off and put every answer up, so it does nothing for them.
      const student = sharedRef.current?.student === true
      if (ra) {
        e.preventDefault()
        if (ra === 'toggle') {
          if (!student) toggleReveal()
        } else revealStep(ra)
        return
      }
      // …and the teacher's own keys: Analysis (A) and Present (F).
      if (student && !meta && !e.altKey && (key === 'a' || key === 'f')) return
      // View only: the keys that change the board do nothing. Looking keys
      // (reveal, present, analysis, the sidebar) still work.
      if (
        sharedRef.current?.viewOnly &&
        ((meta && (key === 'z' || key === 'y')) ||
          e.key === 'Delete' ||
          e.key === 'Backspace' ||
          NUDGE[e.key] ||
          (key === 'p' && e.shiftKey && !meta))
      ) {
        return
      }
      if (meta && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (meta && key === 'y') {
        e.preventDefault()
        redo()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedRef.current) {
        e.preventDefault()
        deleteSelection()
      } else if (NUDGE[e.key]) {
        const [ux, uy] = NUDGE[e.key]
        const step = e.shiftKey ? 1 : 0.1
        if (nudgeSelected(ux * step, uy * step)) e.preventDefault()
      } else if ((e.key === '+' || e.key === '=') && !meta && !e.altKey) {
        // Zoom from the keyboard, about the centre — the corner's + and −.
        e.preventDefault()
        zoomBy(1.25)
      } else if (e.key === '-' && !meta && !e.altKey) {
        e.preventDefault()
        zoomBy(1 / 1.25)
      } else if (e.key === '\\' && !meta) {
        // The sidebar is half the app and had no key at all.
        e.preventDefault()
        setSidebarOpen((o) => !o)
      } else if (key === 'a' && !meta) {
        setShowAnalysis((v) => {
          const next = !v
          updatePrefs({ showAnalysis: next })
          return next
        })
      } else if (key === 'p' && e.shiftKey && !meta) {
        // The units control lives in the export/settings panel, which is two
        // clicks away mid-lesson; this is the one axis a trig class re-measures.
        e.preventDefault()
        cycleAxisUnitX()
      } else if (key === 'f' && !meta && !e.shiftKey) {
        // One key for the whole mode. A teacher walking to the projector has
        // one hand free and no time to find a menu.
        e.preventDefault()
        setPresentMode((v) => !v)
      } else if (e.key === 'Escape') {
        // An armed pick is the innermost thing Escape can be about: the
        // teacher asked "which second curve?" and is now saying "never mind".
        // It takes the key, so present mode survives the same press.
        if (armedBetweenRef.current) {
          e.preventDefault()
          cancelBetween()
          return
        }
        // Unconditional: leaving a mode you are not in costs nothing, and the
        // alternative is a stale closure deciding whether you are in it.
        setPresentMode(false)
      }
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (sharedRef.current?.viewOnly) return
      if (e.key.startsWith('Arrow')) commitWithSnap(selectedRef.current, false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [
    undo,
    redo,
    cancelBetween,
    deleteSelection,
    nudgeSelected,
    commitWithSnap,
    cycleAxisUnitX,
    toggleReveal,
    revealStep,
    zoomBy,
  ])
}

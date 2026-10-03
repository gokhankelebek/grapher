// ============================================================================
// src/ui/boardKeys.ts — the board's own keys, when the board has focus.
//
// Tab reaches the board (the canvas is focusable, "Skip to board" jumps to
// it). Then:
//
//   nothing selected      ← → ↑ ↓   pan (Shift: further)
//   a curve selected      ← → ↑ ↓   nudge the curve — the App's global rule,
//                                    unchanged (src/app/useKeyboard.ts)
//                         Tab        step onto its first handle, then the
//                                    next; past the last, Tab leaves the board
//                         Shift+Tab  the previous handle; before the first,
//                                    back to the board itself
//   a handle focused      ← → ↑ ↓   move that handle 0.1 (Shift: 1), the same
//                                    edit a drag makes, snapped on release
//                                    unless Alt is held — exactly like a drag
//                         Enter      type its exact value (the double-click
//                                    editor)
//                         Escape     back to the curve
//   a curve selected      Escape     let go of it (arrows then pan)
//   anywhere              + / −      zoom (global, src/app/useKeyboard.ts)
//
// This module is the decision, pure, for the tests; CanvasStage carries it out.
// ============================================================================

export interface BoardKeyState {
  /** A curve is selected (its handles are on the board). */
  hasSelection: boolean
  /** How many handles the selected curve has. */
  handleCount: number
  /** The keyboard-focused handle, by index; null when none is. */
  handleIndex: number | null
}

export type BoardKeyAction =
  /** Focus handle `index`. */
  | { type: 'focus-handle'; index: number }
  /** No handle focused any more; `leave`: let Tab move focus off the board. */
  | { type: 'clear-handle'; leave: boolean }
  /** Move the focused handle by (dx, dy) math units. */
  | { type: 'move-handle'; dx: number; dy: number }
  /** Move the view: `dx`, `dy` in screen px the view travels (right, up positive). */
  | { type: 'pan'; dx: number; dy: number }
  /** Open the exact-value editor on the focused handle. */
  | { type: 'edit-handle' }
  /** Let go of the selected curve (arrows then pan). */
  | { type: 'deselect' }

/** A handle moves this far per arrow press (Shift: HANDLE_BIG_STEP), in math units. */
export const HANDLE_STEP = 0.1
export const HANDLE_BIG_STEP = 1
/** The view moves this far per arrow press (Shift: PAN_BIG_STEP_PX). */
export const PAN_STEP_PX = 40
export const PAN_BIG_STEP_PX = 160

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
}

interface KeyLike {
  key: string
  shiftKey?: boolean
  altKey?: boolean
  metaKey?: boolean
  ctrlKey?: boolean
}

/**
 * What a key does on the focused board, or null when the board does not take
 * it (it then goes on to the App's global shortcuts, or the browser's Tab).
 */
export function boardKeyAction(e: KeyLike, s: BoardKeyState): BoardKeyAction | null {
  if (e.metaKey || e.ctrlKey) return null
  const focused = s.handleIndex !== null && s.handleIndex >= 0 && s.handleIndex < s.handleCount
  if (e.key === 'Tab') {
    if (e.altKey || !s.hasSelection || s.handleCount === 0) {
      return focused ? { type: 'clear-handle', leave: true } : null
    }
    if (e.shiftKey) {
      if (!focused) return null
      return s.handleIndex === 0 ? { type: 'clear-handle', leave: false } : { type: 'focus-handle', index: s.handleIndex! - 1 }
    }
    if (!focused) return { type: 'focus-handle', index: 0 }
    return s.handleIndex! < s.handleCount - 1
      ? { type: 'focus-handle', index: s.handleIndex! + 1 }
      : { type: 'clear-handle', leave: true }
  }
  const dir = ARROWS[e.key]
  if (dir) {
    if (focused) {
      const step = e.shiftKey ? HANDLE_BIG_STEP : HANDLE_STEP
      return { type: 'move-handle', dx: dir[0] * step, dy: dir[1] * step }
    }
    if (!s.hasSelection && !e.altKey) {
      const step = e.shiftKey ? PAN_BIG_STEP_PX : PAN_STEP_PX
      return { type: 'pan', dx: dir[0] * step, dy: dir[1] * step }
    }
    return null
  }
  if (focused && (e.key === 'Enter' || e.key === ' ')) return { type: 'edit-handle' }
  if (e.key === 'Escape' && !e.shiftKey && !e.altKey) {
    if (focused) return { type: 'clear-handle', leave: false }
    if (s.hasSelection) return { type: 'deselect' }
  }
  return null
}

/** "the vertex handle", "the domain start handle": a handle's spoken name. */
export function handleWords(label: string | undefined, id: string): string {
  const raw = (label ?? id).replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase()
  return /handle$/.test(raw) ? raw : `${raw} handle`
}

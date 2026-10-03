// ============================================================================
// src/ui/useDialogFocus.ts — a modal dialog's keyboard contract, once.
//
//   * focus moves INTO the dialog when it opens (its first field or button,
//     or `initial`), so a keyboard user is where the dialog is;
//   * Tab and Shift+Tab cycle inside it and never fall through to the board;
//   * Escape closes it (unless the dialog handles Escape itself: escape=false);
//   * focus RETURNS to whatever opened it when it closes.
//
// The palette, the help sheet and the examples gallery already did all four
// by hand; the share dialog, the worksheet editor, the item-bank dialogs and
// "Describe this graph" use this.
// ============================================================================

import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** The elements Tab can reach inside `root`, in order. */
export function focusablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true' && (el.offsetParent !== null || el === document.activeElement),
  )
}

/**
 * Where Tab goes from `active` among `list` (wrapping), or null when the
 * browser's own order is right. Pure, for the tests.
 */
export function trapTarget(list: readonly HTMLElement[], active: Element | null, back: boolean): HTMLElement | null {
  if (list.length === 0) return null
  const i = active ? list.indexOf(active as HTMLElement) : -1
  if (i < 0) return back ? list[list.length - 1] : list[0]
  if (back && i === 0) return list[list.length - 1]
  if (!back && i === list.length - 1) return list[0]
  return null
}

export interface DialogFocusOptions {
  /** Escape closes the dialog (default true). False when it handles Escape itself. */
  escape?: boolean
  /** A selector inside the dialog to focus first. */
  initial?: string
  /** Move focus in on open (default true). False when the dialog already does. */
  autoFocus?: boolean
  /**
   * Where focus goes on close when the opener is gone (a menu item that closed
   * with its menu): a selector, e.g. '#board-canvas'.
   */
  fallback?: string
}

export function useDialogFocus(
  ref: RefObject<HTMLElement>,
  onClose: () => void,
  opts: DialogFocusOptions = {},
): void {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const { escape = true, initial, autoFocus = true, fallback } = opts

  useEffect(() => {
    const root = ref.current
    if (!root) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (autoFocus && !root.contains(document.activeElement)) {
      const first = (initial ? root.querySelector<HTMLElement>(initial) : null) ?? focusablesIn(root)[0] ?? root
      if (first === root && !root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1')
      first.focus({ preventScroll: true })
    }
    const onKey = (e: KeyboardEvent): void => {
      if (!root.isConnected) return
      if (e.key === 'Escape' && escape) {
        e.preventDefault()
        e.stopPropagation()
        closeRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const to = trapTarget(focusablesIn(root), document.activeElement, e.shiftKey)
      if (to) {
        e.preventDefault()
        to.focus()
      }
    }
    // At the window, in the capture phase: several dialogs stop every key at
    // the window so the board's shortcuts cannot fire behind them, and a
    // listener on the dialog itself would never hear Tab.
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      // Back to the opener, if it is still on the page and nothing else took focus.
      const lost = document.activeElement === document.body || root.contains(document.activeElement) || !document.activeElement
      if (!lost) return
      const back = opener && opener.isConnected ? opener : fallback ? document.querySelector<HTMLElement>(fallback) : null
      back?.focus({ preventScroll: true })
    }
    // Once per opening: the dialog mounts, the hook runs, it unmounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

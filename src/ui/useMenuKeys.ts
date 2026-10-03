// ============================================================================
// src/ui/useMenuKeys.ts — a drop-down's keyboard contract.
//
// While `open`:
//   * focus moves to the first item (role=menuitem…, or the first control of
//     a settings panel), so the keyboard is where the menu is;
//   * ↓ / ↑ move between items and wrap, Home / End jump (menus only —
//     a settings panel keeps arrows for its own fields and segments);
//   * Escape closes it and puts focus back on the button that opened it.
// Tab leaves the menu the ordinary way; the menu's own outside-click rule
// closes it.
// ============================================================================

import { useEffect } from 'react'
import type { RefObject } from 'react'
import { focusablesIn } from './useDialogFocus'

const ITEMS = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]'

/** The next item index for a key, or null when the key is not a menu key. Pure, for the tests. */
export function menuStep(key: string, index: number, count: number): number | null {
  if (count <= 0) return null
  switch (key) {
    case 'ArrowDown':
      return index < 0 ? 0 : (index + 1) % count
    case 'ArrowUp':
      return index < 0 ? count - 1 : (index - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}

export interface MenuKeysOptions {
  /** Arrow keys move between items (a role=menu). False for a settings panel. */
  arrows?: boolean
}

export function useMenuKeys(
  open: boolean,
  menuRef: RefObject<HTMLElement>,
  triggerRef: RefObject<HTMLElement>,
  close: () => void,
  opts: MenuKeysOptions = {},
): void {
  const arrows = opts.arrows !== false
  useEffect(() => {
    if (!open) return
    const menu = menuRef.current
    if (!menu) return
    const items = (): HTMLElement[] =>
      arrows
        ? Array.from(menu.querySelectorAll<HTMLElement>(ITEMS)).filter((el) => !el.hasAttribute('disabled'))
        : focusablesIn(menu)
    // Only when the keyboard opened it would a sighted mouse user mind; moving
    // focus in is right for both, and it is what a screen reader expects.
    const first = items()[0]
    if (first && !menu.contains(document.activeElement)) first.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        const inside = menu.contains(document.activeElement) || document.activeElement === triggerRef.current
        close()
        if (inside) triggerRef.current?.focus()
        return
      }
      if (!arrows || !menu.contains(document.activeElement)) return
      const list = items()
      const next = menuStep(e.key, list.indexOf(document.activeElement as HTMLElement), list.length)
      if (next === null) return
      e.preventDefault()
      // Captured and stopped: an arrow in a menu must not also nudge the
      // selected curve (the board's arrow keys listen at the window).
      e.stopPropagation()
      list[next]?.focus()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, arrows, menuRef, triggerRef, close])
}

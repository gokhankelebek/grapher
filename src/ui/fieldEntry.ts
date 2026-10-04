// ============================================================================
// src/ui/fieldEntry.ts — how a card's click-to-type number field takes a value.
//
//   [ a  0 ]  click → [ a |0.5   ]  Enter / Tab / click away → [ a  0.5 ]
//
// One behaviour for every such field (the Riemann and area bounds, a secant's
// a and b, a limit's a, Taylor's centre, a volume's bounds, Euler's steps …):
//
//   * Enter commits; Esc cancels.
//   * Tab commits and moves on: the next field opens for typing (Shift+Tab:
//     the previous one), and anything else in the card simply takes focus.
//     It used to throw the typed value away.
//   * Leaving the field (a click elsewhere) commits too — when the text was
//     changed and reads as a value. Unchanged or unreadable text just closes.
//
// Each section keeps its own `commit()` (which already refuses a bad value by
// marking the field) and `cancel()`; this file only decides WHEN they run.
// ============================================================================

import type { FocusEvent, KeyboardEvent } from 'react'
import { parseNumeric } from './numeric'

/** The props a field's <input> takes from entryHandlers. */
export interface EntryHandlers {
  onFocus(e: FocusEvent<HTMLInputElement>): void
  onKeyDown(e: KeyboardEvent<HTMLInputElement>): void
  onBlur(e: FocusEvent<HTMLInputElement>): void
}

/** Whatever can take focus inside `scope`, in document order. */
function tabbables(scope: Element): HTMLElement[] {
  const all = scope.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )
  return Array.from(all).filter((el) => el.getClientRects().length > 0 && el.getAttribute('aria-hidden') !== 'true')
}

/** The region Tab moves within: the card (else the sidebar, else the page). */
function scopeOf(el: Element): Element {
  return el.closest('.card') ?? el.closest('.sidebar') ?? document.body
}

/**
 * After the field at `fieldIndex` (of the `.calc-field`s in `scope`) has turned
 * back into its button: move to the next (or previous) focusable thing. A
 * field opens for typing; anything else just takes focus.
 */
export function advanceFrom(scope: Element, fieldIndex: number, back: boolean): void {
  const fields = Array.from(scope.querySelectorAll<HTMLElement>('.calc-field'))
  const here = fields[fieldIndex]
  if (!here) return
  const anchor: HTMLElement =
    here.matches('button, input') ? here : (here.querySelector<HTMLElement>('button, input') ?? here)
  const list = tabbables(scope)
  const at = list.indexOf(anchor)
  const next = at < 0 ? null : list[back ? at - 1 : at + 1]
  if (!next) {
    anchor.focus()
    return
  }
  if (next.classList.contains('calc-field-btn')) next.click()
  else next.focus()
}

const afterRender = (run: () => void): void => {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(run)
  } else {
    setTimeout(run, 0)
  }
}

/**
 * Enter / Tab / Esc / blur handling for one open number field.
 *
 * `commit` reads the field's text (the section's own state) and either applies
 * it and closes the field, or marks it bad and leaves it open. `cancel` closes
 * it unchanged. `valid` says whether text reads as a value (default: anything
 * parseNumeric reads — 1/2, -pi, sqrt(2)).
 */
export function entryHandlers(
  commit: () => void,
  cancel: () => void,
  valid: (text: string) => boolean = (t) => parseNumeric(t) !== null,
): EntryHandlers {
  const changed = (el: HTMLInputElement): boolean => el.dataset.initial === undefined || el.value !== el.dataset.initial
  const finish = (el: HTMLInputElement, run: () => void): void => {
    el.dataset.done = '1'
    run()
    // A refused value leaves the field open: it is live again.
    afterRender(() => {
      if (el.isConnected) delete el.dataset.done
    })
  }
  return {
    onFocus(e) {
      const el = e.currentTarget
      if (el.dataset.initial === undefined) el.dataset.initial = el.value
    },
    onKeyDown(e) {
      e.stopPropagation()
      const el = e.currentTarget
      if (e.key === 'Enter') {
        e.preventDefault()
        finish(el, commit)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        finish(el, cancel)
      } else if (e.key === 'Tab') {
        e.preventDefault()
        const scope = scopeOf(el)
        const wrap = el.closest('.calc-field') ?? el
        const index = Array.from(scope.querySelectorAll('.calc-field')).indexOf(wrap)
        const back = e.shiftKey
        if (!changed(el)) finish(el, cancel)
        else if (!valid(el.value)) {
          finish(el, commit) // marks it bad and keeps it open
          return
        } else finish(el, commit)
        afterRender(() => {
          if (el.isConnected) return // refused: stay on it
          advanceFrom(scope, index, back)
        })
      }
    },
    onBlur(e) {
      const el = e.currentTarget
      if (el.dataset.done === '1') return
      el.dataset.done = '1'
      if (changed(el) && valid(el.value)) commit()
      else cancel()
      afterRender(() => {
        // Still open (the section refused the value): give up on it — the
        // teacher has moved on, and a red field nobody is in helps no one.
        if (el.isConnected) cancel()
      })
    },
  }
}

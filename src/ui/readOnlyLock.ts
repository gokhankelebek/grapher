// ============================================================================
// src/ui/readOnlyLock.ts — a view-only sidebar: read, open, reveal; never edit.
//
// A view-only share link (a teacher's colleague, or a student in reveal mode)
// used to make the whole card list `inert`. That stopped every edit, and also
// every LOOK: a student could not open a card (select it), open a folded
// section, or press a card's "? Reveal" — which the sidebar's own note told
// them to do. Inert cannot spare a descendant, so the list is no longer inert;
// this lock stands in for it. In the capture phase, before any card hears the
// event, it stops what would change the board:
//
//   * a press, a tap, a key or typed text aimed at an editing control (a
//     button, field, select, slider, link or menu item) — except the controls
//     that only LOOK: a "? Reveal" pill and a section's fold toggle;
//   * a paste, a drop or a drag anywhere in the list (a table card takes
//     pasted columns on its own frame).
//
// Clicking a card's frame still selects it (opens it), which is looking too.
// What the stylesheet hides in view-only (`.sidebar-readonly`, styles.css) is
// the rest of the promise: dead controls are not shown at all.
// ============================================================================

/** Controls that only look: never blocked. */
export const LOOK_CONTROLS = '.reveal-pill, .cs-toggle, [data-ro-allow]'

/** What counts as an editing control in a card. */
export const EDIT_CONTROLS = [
  'button',
  'input',
  'select',
  'textarea',
  'label',
  'a[href]',
  '[role="button"]',
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="menuitemcheckbox"]',
  '[role="slider"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="option"]',
  '[contenteditable="true"]',
  '[contenteditable=""]',
].join(', ')

/** Events stopped on an editing control. */
export const LOCKED_ON_CONTROLS = ['click', 'dblclick', 'mousedown', 'pointerdown', 'keydown', 'beforeinput', 'contextmenu'] as const

/** Events stopped anywhere in the list. */
export const LOCKED_EVERYWHERE = ['paste', 'drop', 'dragstart', 'cut'] as const

/** Keys that move focus or dismiss, which a view-only list still lets through. */
const PASS_KEYS = new Set(['Tab', 'Escape'])

interface ClosestTarget {
  closest(selector: string): unknown
}

function isTarget(t: unknown): t is ClosestTarget {
  return typeof t === 'object' && t !== null && typeof (t as ClosestTarget).closest === 'function'
}

/**
 * Should a view-only list stop this event? `boundary` (the list) bounds the
 * search: a control outside it is not the list's to lock. Pure but for the
 * DOM queries on `target`.
 */
export function readOnlyBlocks(
  type: string,
  target: unknown,
  opts: { key?: string; boundary?: { contains(n: unknown): boolean } } = {},
): boolean {
  if ((LOCKED_EVERYWHERE as readonly string[]).includes(type)) return true
  if (!(LOCKED_ON_CONTROLS as readonly string[]).includes(type)) return false
  if (!isTarget(target)) return false
  if (target.closest(LOOK_CONTROLS)) return false
  const control = target.closest(EDIT_CONTROLS)
  if (!control) return false
  if (opts.boundary && !opts.boundary.contains(control)) return false
  if (type === 'keydown' && opts.key !== undefined && PASS_KEYS.has(opts.key)) return false
  return true
}

/** Lock `el` (the card list) while view-only. Returns the unlock. */
export function lockReadOnly(el: HTMLElement): () => void {
  const handler = (e: Event): void => {
    const key = e instanceof KeyboardEvent ? e.key : undefined
    if (!readOnlyBlocks(e.type, e.target, { key, boundary: el })) return
    e.preventDefault()
    e.stopPropagation()
  }
  const types = [...LOCKED_ON_CONTROLS, ...LOCKED_EVERYWHERE]
  for (const t of types) el.addEventListener(t, handler, { capture: true })
  return () => {
    for (const t of types) el.removeEventListener(t, handler, { capture: true })
  }
}

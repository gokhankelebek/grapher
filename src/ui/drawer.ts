// ============================================================================
// src/ui/drawer.ts — when the sidebar is a drawer, and how it starts.
//
// At 900 px and below (portrait iPad, phone) the sidebar stops taking width
// from the board and floats over it as a drawer (styles.css, "small screens").
// A drawer that opened on load covered the toolbar's sidebar toggle, document
// name and document menu — nothing said a tap on the board closes it — and on
// a student's link it clipped the question banner. So below that width the
// app starts with the drawer CLOSED; the ☰ toggle opens it, and the drawer has
// its own × to close.
// ============================================================================

/** Widest viewport (CSS px) at which the sidebar is a drawer — styles.css's `max-width: 900px`. */
export const DRAWER_MAX_W = 900

/** Is the sidebar a drawer at this viewport width? Pure. */
export function isDrawerWidth(width: number): boolean {
  return Number.isFinite(width) && width <= DRAWER_MAX_W
}

/** Does the sidebar start open at this viewport width? Closed when it would be a drawer. Pure. */
export function sidebarStartsOpen(width: number): boolean {
  return !isDrawerWidth(width)
}

/** The viewport width now, or a wide default where there is no window (tests, SSR). */
export function viewportWidth(): number {
  return typeof window !== 'undefined' && typeof window.innerWidth === 'number' ? window.innerWidth : 1366
}

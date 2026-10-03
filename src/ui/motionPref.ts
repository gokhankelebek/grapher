// ============================================================================
// src/ui/motionPref.ts — the system's "reduce motion" setting, for the
// animations CSS cannot reach: Play (a particle, the unit circle, related
// rates), reveal mode's rings and the fade of a just-recognised stroke.
//
// CSS animations and transitions (the sidebar slide, toasts, the reveal fade
// in a card) are already cut by the stylesheet's prefers-reduced-motion rule.
// ============================================================================

const QUERY = '(prefers-reduced-motion: reduce)'

/** True when the person has asked their system for less motion. */
export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches
  } catch {
    return false
  }
}

/** Under reduced motion, Play moves in steps this far apart instead of every frame. */
export const REDUCED_STEP_S = 0.5

/**
 * A Play loop's clock. Each animation frame asks it how much time to advance
 * by: every frame (capped at 0.1 s, as the loops always did), or — under
 * reduced motion — nothing until half a second has gathered, then all of it
 * at once. Play still plays; it just does not glide.
 */
export function playClock(start: number, reduced: boolean = prefersReducedMotion()): (now: number) => number | null {
  let last = start
  let pending = 0
  return (now: number): number | null => {
    const dt = Math.max(0, (now - last) / 1000)
    last = now
    if (!reduced) return Math.min(0.1, dt)
    pending += Math.min(0.25, dt)
    if (pending < REDUCED_STEP_S) return null
    const out = pending
    pending = 0
    return out
  }
}

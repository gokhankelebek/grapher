// ============================================================================
// src/ui/coach.ts — the one-time tips, counted in one place.
//
// The endpoint tip ("click to switch between included and excluded") has two
// homes: the toggle on the card, and the dot on the canvas. It is the SAME
// sentence about the same fact, so it is shown once per session across both —
// a teacher who has read it beside the card must not meet it again over the
// line, and whichever surface they approach first is the one that teaches it.
//
// Session-scoped on purpose: module state, not storage. A tip that is never
// shown again is a tip that is gone for the colleague borrowing the laptop,
// and this one costs a line of text for the five seconds it is up.
// ============================================================================

const spent = new Set<string>()

/**
 * Claim a one-time tip. True exactly once per key per session; every later
 * call — from either surface — is false.
 */
export function takeTip(key: string): boolean {
  if (spent.has(key)) return false
  spent.add(key)
  return true
}

/** Test seam: forget what has been shown. */
export function resetTips(): void {
  spent.clear()
}

export const ENDPOINT_TIP = 'endpoint-open-closed'

export const ENDPOINT_TIP_TEXT =
  'Click an endpoint to switch it between included and excluded.'

/** How long a tip stays up before it stops being worth the room. */
export const TIP_MS = 5000

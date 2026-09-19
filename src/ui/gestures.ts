// ============================================================================
// src/ui/gestures.ts — what a contact MEANS, decided before any state moves.
//
// Both boards (CanvasStage and NumberLineStage) ask this module the same
// questions, so a palm cannot be rejected on one board and promoted to a pinch
// on the other. Everything here is pure and synchronous: no refs, no React, no
// DOM, which is why the rules can be read — and tested — on their own.
//
// The two bugs this replaces were both destructive and both silent:
//
//   * ANY second pointer was promoted to a pinch. A palm landing mid-stroke
//     cancelled the stroke: no curve, no toast, nothing to undo. A palm resting
//     BEFORE the pen landed also pinched the graph off-screen.
//   * EVERY wheel event zoomed, so a Mac two-finger scroll silently rescaled
//     the whole board — which changes what every gridline means.
// ============================================================================

import { HANDLE_HIT_RADIUS, handleHitRadius } from './renderBoard'
import type { PaintScale } from '../render/grid'

export type PointerKind = 'pen' | 'touch' | 'mouse'

/** Which way the stroke in progress will be read near the selected curve. */
export type DrawIntent = 'reshape' | 'new'

/**
 * How long a pen keeps ownership of the glass after it was last seen.
 *
 * This is the whole finger/pen negotiation, and the window is deliberately
 * long: a teacher sets the Pencil down between strokes, points at the board,
 * scrolls with two fingers and picks it up again. A 2s window would hand ink
 * back to the resting palm in the gap. Thirty seconds is "this is a pen
 * session"; a device with no pen never enters it at all, and keeps drawing
 * with a fingertip.
 */
export const PEN_GUARD_MS = 30_000

/** Travel a finger must cover before it pans — a resting palm never nudges. */
export const TOUCH_PAN_SLOP = 6

/**
 * A finger's ink stays invisible this long.
 *
 * A two-finger pinch arrives as two pointerdowns a few tens of ms apart, so on
 * a pen-less device the first finger legitimately starts ink that the second
 * finger immediately cancels. Holding the first strokes of that ink back means
 * the cancelled stroke is never *seen* — the audit's "pinch flashes an ink
 * stroke". The points are still collected, so a real stroke loses nothing.
 */
export const TOUCH_INK_HOLD_MS = 90

/** How far a stroke may sit from a curve and still count as drawn "on" it. */
export const NEIGHBOURHOOD_PX = 60

/** Hit radii at 1:1, before coarse-pointer and presentation scaling. */
const MARKER_HIT_RADIUS = 9
const BODY_HIT_RADIUS = 8
/** The same three, for a fingertip: ~8mm of slop, and it hides its own target. */
const COARSE_HANDLE = 18
const COARSE_MARKER = 16
const COARSE_BODY = 14

export const pointerKind = (t: string | undefined | null): PointerKind =>
  t === 'pen' || t === 'touch' ? t : 'mouse'

export type PointerVerdict =
  /** Ink — or, first, a handle/curve drag: the caller refines this one. */
  | 'ink'
  /** Held pan: space, middle/right button, or a single finger. */
  | 'pan'
  /** Second finger: pinch-zoom. */
  | 'pinch'
  /** Palm rejection — this contact does not exist as far as the board cares. */
  | 'ignore'
  /** Pen/mouse over a touch gesture: drop the touch, the pen wins. */
  | 'preempt'

/**
 * The single place a contact becomes an intention.
 *
 * `contacts` counts the pointers already down, NOT including this one.
 *
 * The finger rule is the one worth stating out loud, because both extremes are
 * wrong. Refusing ink to every finger strands a teacher who has a phone, or an
 * iPad with no Pencil, with no way to sketch at all. Accepting ink from every
 * finger means a palm draws. So the finger draws until a pen has been seen,
 * and from then on (see PEN_GUARD_MS) it only pans and pinches — the same
 * bargain Procreate and Notability strike.
 */
export function classifyPointerDown(i: {
  kind: PointerKind
  button: number
  spaceHeld: boolean
  /** Pointer kind owning the gesture in progress; null when idle. */
  activeKind: PointerKind | null
  contacts: number
  /** A pen has been seen within PEN_GUARD_MS — fingers stop inking. */
  penRecent: boolean
}): PointerVerdict {
  // Palm rejection: a finger arriving while the pen is working is not a pinch,
  // not a pan, and above all not a reason to throw the stroke away.
  if (i.kind === 'touch' && i.activeKind === 'pen') return 'ignore'
  // The pen outranks a palm that happened to get there first.
  if (i.kind !== 'touch' && i.activeKind === 'touch') return 'preempt'
  if (i.button !== 0) return 'pan'
  if (i.spaceHeld) return 'pan'
  if (i.kind === 'touch') {
    // Two fingers are always a pinch, whoever owns the glass.
    if (i.contacts >= 1) return 'pinch'
    return i.penRecent ? 'pan' : 'ink'
  }
  // A second pen/mouse contact is a phantom, never a pinch.
  if (i.contacts >= 1) return 'ignore'
  return 'ink'
}

/** True while the pen still owns the glass and a bare touch is distrusted. */
export const penGuardActive = (lastPenAt: number, now: number): boolean =>
  now - lastPenAt < PEN_GUARD_MS

/**
 * A plain (or two-axis) wheel is a SCROLL, and must pan. Only a pinch — which
 * browsers deliver as a ctrlKey wheel — or an explicit modifier zooms.
 */
export const classifyWheel = (e: { ctrlKey: boolean; metaKey: boolean }): 'zoom' | 'pan' =>
  e.ctrlKey || e.metaKey ? 'zoom' : 'pan'

/** Wheel deltas in CSS px, whichever unit the event chose to speak in. */
export function wheelPanDelta(
  e: { deltaX: number; deltaY: number; deltaMode?: number },
  pageH: number,
): { dx: number; dy: number } {
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? Math.max(1, pageH) : 1
  const fin = (v: number): number => (Number.isFinite(v) ? v : 0)
  return { dx: fin(e.deltaX) * unit, dy: fin(e.deltaY) * unit }
}

/**
 * Did the stroke spend most of itself away from the curve it started on? Then
 * it is a new object drawn NEXT TO that curve — a tangent, an asymptote, a
 * translated copy — and blending it in would rewrite the wrong thing.
 */
export const strokeLeftBand = (inside: number, total: number): boolean =>
  total > 0 && inside * 2 < total

export interface HitRadii {
  handle: number
  marker: number
  body: number
}

/**
 * Hit radii grow for fingers, and again for a board scaled up to be read from
 * the back of a room. The DRAWN sizes belong to renderBoard: a board that
 * redrew itself fatter on an iPad would be a different figure, not a more
 * reachable one.
 *
 * The handle radius is renderBoard's own handleHitRadius(present), never a
 * local copy, and the other two follow the same multiplier — otherwise the
 * three drift apart the moment `present` starts moving.
 */
export function hitRadii(coarse: boolean, present?: PaintScale | null): HitRadii {
  const handle = handleHitRadius(present)
  const scale = handle / HANDLE_HIT_RADIUS
  return coarse
    ? { handle: COARSE_HANDLE * scale, marker: COARSE_MARKER * scale, body: COARSE_BODY * scale }
    : { handle, marker: MARKER_HIT_RADIUS * scale, body: BODY_HIT_RADIUS * scale }
}

/**
 * Tooltips go ABOVE-LEFT of the pointer: down-right is precisely where a
 * right-handed hand and the barrel of the pen already are. Flips at the edges
 * of the stage so it can never be pushed out of the frame.
 */
export function tipPlacement(
  x: number,
  y: number,
): { left: number; top: number; transform: string } {
  const flipX = x < 150
  const flipY = y < 44
  return {
    left: flipX ? x + 14 : x - 12,
    top: flipY ? y + 16 : y - 12,
    transform: `translate(${flipX ? '0' : '-100%'}, ${flipY ? '0' : '-100%'})`,
  }
}

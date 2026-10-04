// ============================================================================
// src/ui/presentClearance.ts — in Present, the "Revealed" panel never covers
// the figure it explains.
//
// The panel (src/ui/PresentAnswers.tsx) stands at the side of the board the
// legend leaves free, set at the presentation's type scale: at 2.5× on a
// 1366×768 projector it is a third of the board wide. On the U6 rate-table
// example it hid the "avg ≈ 6.242" label and the (12, 8.4) data point — the
// very answer it was announcing.
//
// The panel stays at the side (a strip along the bottom would sit on the x
// axis's numbers, where most AP figures keep their baseline, and wrap a long
// worked line across the whole wall). Instead the VIEW makes room: when the
// figure's content, with room for its labels, meets the panel, the board pans
// the content clear of it — the smallest move, at the same scale, so the
// numbers the class is reading stay the size they were — and only when the
// content is wider than the room beside the panel does it shrink the view to
// fit there. useBoardClearance applies it and puts the view back when the
// panel goes away.
//
// Pure: screen rectangles in, a move out.
// ============================================================================

import type { Box } from './viewScale'
import type { Viewport } from '../core/types'
import { ppuX, ppuY, toScreen } from '../core/types'

/** A rectangle on the board, px from its top-left corner. */
export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * The figure's content on the board: its features (`inner`) and, around
 * them, the room its labels take (the rectangle itself). A shrink scales the
 * features; the labels stay their size.
 */
export interface ContentRect extends Rect {
  innerLeft: number
  innerRight: number
}

/** Scale the content's features about their center by `s`, then shift them right by `dx` px. */
export interface ClearanceMove {
  s: number
  dx: number
}

/** Room kept between the content and the panel (and the board's edge), px. */
export const CLEAR_GAP = 12

/**
 * Room around the content's features for what is drawn beside them, px per
 * unit of type scale: a value plate ("avg ≈ 6.242") stands to the right of
 * its point, the axis numbers under and left of the axes.
 */
export const LABEL_ROOM_X = 76
export const LABEL_ROOM_Y = 20

function overlaps(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

/**
 * The content's rectangle on the board: the box (math coordinates) on screen,
 * widened for its labels, and clipped to the board — only what can be seen
 * can be covered.
 */
export function contentRect(box: Box, vp: Viewport, type: number): ContentRect {
  const a = toScreen(box.min, vp)
  const b = toScreen(box.max, vp)
  const mx = LABEL_ROOM_X * type
  const my = LABEL_ROOM_Y * type
  const clipX = (x: number): number => Math.min(vp.widthPx, Math.max(0, x))
  const innerLeft = clipX(Math.min(a.x, b.x))
  const innerRight = clipX(Math.max(a.x, b.x))
  return {
    left: clipX(innerLeft - mx),
    right: clipX(innerRight + mx),
    top: Math.max(0, Math.min(a.y, b.y) - my),
    bottom: Math.min(vp.heightPx, Math.max(a.y, b.y) + my),
    innerLeft,
    innerRight,
  }
}

/**
 * How to move the content so the panel does not cover it — or null when it
 * does not. The panel's side is the side of the board its middle is on. A pan
 * when the content fits in the room beside the panel (the least movement that
 * clears it); otherwise the features are shrunk until they, with their
 * labels' room, fill the room beside the panel.
 */
export function panelClearance(content: ContentRect, panel: Rect, boardW: number, gap = CLEAR_GAP): ClearanceMove | null {
  if (!(content.right > content.left) || !(panel.right > panel.left)) return null
  if (!overlaps(content, panel)) return null
  const right = panel.left + panel.right > boardW
  const lo = right ? gap : panel.right + gap
  const hi = right ? panel.left - gap : boardW - gap
  const room = hi - lo
  // No room beside the panel worth moving into (a phone in Present).
  if (room < 120) return null
  const w = content.right - content.left
  if (w <= room) {
    const dx = right ? hi - content.right : lo - content.left
    return { s: 1, dx }
  }
  // Shrink the features so they and their labels' room fill the room beside
  // the panel; the labels keep their size.
  const ml = content.innerLeft - content.left
  const mr = content.right - content.innerRight
  const wi = content.innerRight - content.innerLeft
  if (!(wi > 0)) return null
  const s = Math.max(0.2, Math.min(1, (room - ml - mr) / wi))
  const center = lo + ml + (wi * s) / 2
  return { s, dx: center - (content.innerLeft + content.innerRight) / 2 }
}

/**
 * Apply a move to the view: the center of the content's features (a point in
 * math coordinates) lands `dx` px further right, every length scaled by `s`.
 * The content's vertical center stays where it is. Mutates `vp`.
 */
export function applyClearance(vp: Viewport, content: ContentRect, move: ClearanceMove): void {
  const cx = (content.innerLeft + content.innerRight) / 2
  const cy = (content.top + content.bottom) / 2
  const wx = vp.center.x + (cx - vp.widthPx / 2) / ppuX(vp)
  const wy = vp.center.y + (vp.heightPx / 2 - cy) / ppuY(vp)
  if (move.s !== 1) {
    vp.pxPerUnit *= move.s
    if (vp.pxPerUnitY !== undefined) vp.pxPerUnitY *= move.s
  }
  vp.center = {
    x: wx - (cx + move.dx - vp.widthPx / 2) / ppuX(vp),
    y: wy - (vp.heightPx / 2 - cy) / ppuY(vp),
  }
}

/** The parts of a view that a clearance changes, to compare and restore. */
export interface ViewSnap {
  cx: number
  cy: number
  ppu: number
  ppuY: number | undefined
}

export function snapView(vp: Viewport): ViewSnap {
  return { cx: vp.center.x, cy: vp.center.y, ppu: vp.pxPerUnit, ppuY: vp.pxPerUnitY }
}

export function sameView(a: ViewSnap, b: ViewSnap): boolean {
  const near = (p: number, q: number): boolean => Math.abs(p - q) <= 1e-9 * Math.max(1, Math.abs(p), Math.abs(q))
  return (
    near(a.cx, b.cx) &&
    near(a.cy, b.cy) &&
    near(a.ppu, b.ppu) &&
    (a.ppuY === undefined ? b.ppuY === undefined : b.ppuY !== undefined && near(a.ppuY, b.ppuY))
  )
}

export function restoreView(vp: Viewport, s: ViewSnap): void {
  vp.center = { x: s.cx, y: s.cy }
  vp.pxPerUnit = s.ppu
  if (s.ppuY !== undefined) vp.pxPerUnitY = s.ppuY
  else delete vp.pxPerUnitY
}

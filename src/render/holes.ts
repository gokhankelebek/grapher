// ============================================================================
// src/render/holes.ts — the two marks a graph with a break has to carry.
//
//   drawHoles()       an open ring where the formula has a limit but no value
//   drawAsymptotes()  a dashed rule where it runs away — vertical at a pole,
//                     slanted where a polar curve leans on a line
//
// WHY THE RING IS NOT A FIGURE CONVENTION
//
// Every other mark in this renderer is a choice: the screen says nothing about
// the ends of a graph, an exam figure arrows them. A HOLE is not a choice. A
// board that draws (x²−1)/(x−1) as an unbroken line through (1, 2) has stated
// something false about the function — the one point that is not on the graph
// is the point the question is about. So the ring is drawn in EVERY figure
// style, Screen included: it is what stops the board lying.
//
// The ring is deliberately the SAME glyph as an open end cap — the ground-
// filled disc with an ink ring from src/render/endCaps.ts, drawn from the same
// two constants — because a reader is being told the same thing in both
// places: this point is not on the graph. Two glyphs for one fact would be two
// things to learn.
//
// An ASYMPTOTE is the other case, and it IS a figure convention. A textbook,
// SAT or AP figure rules a dashed line at a pole and lets the curve approach
// it; the screen draws nothing, because the break in the stroke already says
// it and a dashed rule on a lit board reads as a second curve. It is drawn
// UNDER the curve, so the curve it belongs to sits on top of it.
//
// These take the LISTS, not the curve: finding them is src/core/holes.ts's
// job (findHoles / findAsymptotes), and keeping the arithmetic on one side of
// the seam and the ink on the other is what lets either be tested alone. An
// `Asymptote` is a LINE, not an x: a vertical one names its x, a slant one
// names a point and a direction, and the renderer is the only thing that knows
// which piece of either is on the board.
//
// Screen px throughout. FIGURE, not chrome: both run with `chrome: null` and
// reach the exported PNG, and both scale with `present.stroke`.
// ============================================================================

import type { Asymptote, Vec2, Viewport } from '../core/types'
import { ppuX, ppuY, toScreen } from '../core/types'
import { END_DOT_R, END_OPEN_RING } from './endCaps'

const TWO_PI = Math.PI * 2

/** The dashed asymptote's line weight, × present.stroke. */
export const ASYMPTOTE_WIDTH = 1
/** Its dash pattern, × present.stroke. */
export const ASYMPTOTE_DASH: readonly [number, number] = [6, 4]
/**
 * Its alpha, relative to whatever the curve is being drawn at.
 *
 * A pole is a fact about the curve, but the RULE is scaffolding for reading
 * it: at full weight two asymptotes on a tangent graph out-shout the graph.
 */
export const ASYMPTOTE_ALPHA = 0.7
/**
 * How far past the visible board holes and poles are looked for, as a
 * fraction of the visible span.
 *
 * Not zero: a ring whose centre is one pixel off the left edge still shows
 * half its ink on the board, and a hole that pops into existence as the board
 * is panned by a pixel is a flicker. Not large either — every candidate costs
 * a bisection in core, and nothing off the board is ever drawn.
 */
export const RANGE_PAD = 0.1

/**
 * The x-range to ask src/core/holes.ts about: the visible board, padded.
 *
 * The renderer owns this because the renderer is the only thing that knows
 * what is visible. Returns null when the viewport has no extent, which is the
 * signal not to ask at all.
 */
export function holeRange(vp: Viewport): [number, number] | null {
  if (!(vp.pxPerUnit > 0) || !(vp.widthPx > 0) || !Number.isFinite(vp.center.x)) return null
  const span = vp.widthPx / vp.pxPerUnit
  if (!Number.isFinite(span) || span <= 0) return null
  const pad = span * RANGE_PAD
  return [vp.center.x - span / 2 - pad, vp.center.x + span / 2 + pad]
}

export interface HolePaint {
  /** The curve's ink — already print-mapped, already mono where mono applies. */
  color: string
  /** The ground, which is what fills the ring. */
  bg: string
  /** Presentation scale on line weight (BoardScene.present.stroke). */
  stroke: number
}

/**
 * One open ring, byte-for-byte the open end cap of src/render/endCaps.ts.
 *
 * Kept as its own function so the two can be compared directly in a test: if
 * this ever drifts from drawDot(..., closed = false) the glyphs stop meaning
 * the same thing, and the reader is the one who pays.
 */
function ring(ctx: CanvasRenderingContext2D, at: Vec2, paint: HolePaint): void {
  const r = END_DOT_R * paint.stroke
  ctx.beginPath()
  ctx.arc(at.x, at.y, r, 0, TWO_PI)
  ctx.fillStyle = paint.bg
  ctx.fill()
  ctx.lineWidth = END_OPEN_RING * paint.stroke
  ctx.strokeStyle = paint.color
  ctx.stroke()
}

/**
 * Two marks this close together are one mark: the width of the glyph itself.
 * Two DISTINCT holes nearer than this would already be one blob of ink.
 */
const SAME_POINT = END_DOT_R

/**
 * Draw an open ring at every hole that lands on the board.
 *
 * `holes` is whatever src/core/holes.ts returned — only `.x` and `.y`, in math
 * coordinates, are read, so a `Hole` and a bare point are both accepted. A
 * hole with a non-finite coordinate is skipped rather than drawn at NaN.
 *
 * `alreadyOpen` is where an OPEN END CAP has already been drawn, in screen px.
 * A graph restricted to [-3, 1] whose right end is the hole gets one hollow
 * circle, not two stacked in the same place — they are the same glyph saying
 * the same thing, and under a faded curve the doubled stroke shows. Only an
 * OPEN cap counts: an arrow or a closed dot at that spot says something else,
 * and the ring still has to be drawn over it.
 *
 * The caller's `globalAlpha` is honoured, not overwritten: a curve faded in or
 * dimmed by its own style fades its rings with it.
 */
export function drawHoles(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  holes: readonly { x: number; y: number }[],
  paint: HolePaint,
  alreadyOpen: readonly Vec2[] = [],
): void {
  if (holes.length === 0) return
  if (!(vp.widthPx > 0) || !(vp.heightPx > 0) || !(vp.pxPerUnit > 0)) return
  // The ring sits ON the board when any of its ink does: a hole a hair past
  // the edge still shows half a ring, and dropping it would be a break in the
  // stroke with nothing to explain it.
  const r = END_DOT_R * paint.stroke
  const at: Vec2[] = []
  for (const h of holes) {
    if (!h || !Number.isFinite(h.x) || !Number.isFinite(h.y)) continue
    const s = toScreen({ x: h.x, y: h.y }, vp)
    if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) continue
    if (s.x < -r || s.y < -r || s.x > vp.widthPx + r || s.y > vp.heightPx + r) continue
    const tol = SAME_POINT * paint.stroke
    if (alreadyOpen.some((o) => Math.hypot(o.x - s.x, o.y - s.y) <= tol)) continue
    at.push(s)
  }
  // Nothing on the board is nothing drawn — not even a save/restore pair. A
  // list whose every hole is off screen has to leave the command stream the
  // board would have had without this feature at all.
  if (at.length === 0) return
  ctx.save()
  try {
    for (const s of at) ring(ctx, s, paint)
  } finally {
    ctx.restore()
  }
}

export type AsymptotePaint = HolePaint

/**
 * The piece of the INFINITE line through `p` in direction `d` that lies on the
 * board — Liang–Barsky, the same clip src/render/curves.ts trims its chords
 * with, run with t unbounded at both ends instead of [0, 1].
 *
 * Both arguments are SCREEN px, and the box is the board itself rather than
 * curves.ts's generous overdraw: an asymptote is one straight stroke, so there
 * is no join to protect and nothing to gain by drawing a viewport past the edge.
 *
 * Null means the line misses the board, only grazes a corner, or was handed a
 * direction of zero length — all three are "nothing to draw" and none of them
 * is an error.
 */
function clipToBoard(p: Vec2, d: Vec2, w: number, h: number): [Vec2, Vec2] | null {
  let t0 = -Infinity
  let t1 = Infinity
  for (let e = 0; e < 4; e++) {
    const pe = e === 0 ? -d.x : e === 1 ? d.x : e === 2 ? -d.y : d.y
    const qe = e === 0 ? p.x : e === 1 ? w - p.x : e === 2 ? p.y : h - p.y
    if (pe === 0) {
      // Parallel to this edge: either wholly inside it, or wholly outside.
      if (qe < 0) return null
      continue
    }
    const r = qe / pe
    if (pe < 0) {
      if (r > t0) t0 = r
    } else if (r < t1) t1 = r
  }
  // A line that leaves the board where it entered it puts no ink on it, and a
  // zero direction never bounded t at all.
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || !(t1 > t0)) return null
  const a = { x: p.x + d.x * t0, y: p.y + d.y * t0 }
  const b = { x: p.x + d.x * t1, y: p.y + d.y * t1 }
  if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) return null
  if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) return null
  return [a, b]
}

/**
 * Draw a dashed rule along every asymptote that crosses the board.
 *
 * A VERTICAL one is the full height of the board — an asymptote is not a
 * segment, and a rule that stopped where the curve happens to leave the board
 * would read as one. A SLANT one is the same statement on a line that is not
 * vertical (r = tan θ leans on x = ±1; a polar spiral leans on a slope), so it
 * is clipped to the board rather than to the curve, and drawn in the same dash,
 * the same weight and the same alpha. One convention, two orientations.
 *
 * Drawn BEFORE the curve, so the curve crosses over it rather than being cut
 * by it. The order of the list is kept, so the command stream a scene with only
 * vertical poles produces is exactly the one it produced when this took a list
 * of x values.
 *
 * The dash and the alpha are restored on the way out by hand as well as by
 * save(): this runs in the middle of the curve loop, and the curve drawn next
 * inherits whatever is left behind.
 */
export function drawAsymptotes(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  lines: readonly Asymptote[],
  paint: AsymptotePaint,
): void {
  if (lines.length === 0) return
  if (!(vp.widthPx > 0) || !(vp.heightPx > 0) || !(vp.pxPerUnit > 0)) return
  // Collected first, so a list whose every line misses the board touches
  // nothing at all — not a save, not a style assignment.
  const at: [Vec2, Vec2][] = []
  for (const line of lines) {
    if (!line) continue
    if (line.kind === 'vertical') {
      // On the board when any of its ink is: a rule ON the edge is still a
      // rule, and it is the same test this drew with when it took bare x.
      if (!Number.isFinite(line.x)) continue
      const sx = toScreen({ x: line.x, y: 0 }, vp).x
      if (!(sx >= 0) || !(sx <= vp.widthPx)) continue
      at.push([{ x: sx, y: 0 }, { x: sx, y: vp.heightPx }])
      continue
    }
    if (line.kind !== 'line') continue
    const p = line.a
    const dir = line.dir
    if (!p || !dir) continue
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
    if (!Number.isFinite(dir.x) || !Number.isFinite(dir.y)) continue
    const s = toScreen(p, vp)
    if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) continue
    // Math y grows UP and screen y grows DOWN, so the direction flips with it.
    // Each component takes its own axis' scale: on a stretched board a slope-1
    // asymptote is NOT drawn at 45°, it is drawn through the screen images of
    // a and a + dir — the same two points the curve approaches.
    const d = { x: dir.x * ppuX(vp), y: -dir.y * ppuY(vp) }
    const seg = clipToBoard(s, d, vp.widthPx, vp.heightPx)
    if (seg) at.push(seg)
  }
  if (at.length === 0) return
  const prevAlpha = ctx.globalAlpha
  const prevDash = typeof ctx.getLineDash === 'function' ? ctx.getLineDash() : []
  ctx.save()
  try {
    ctx.globalAlpha = prevAlpha * ASYMPTOTE_ALPHA
    ctx.strokeStyle = paint.color
    ctx.lineWidth = ASYMPTOTE_WIDTH * paint.stroke
    ctx.setLineDash([ASYMPTOTE_DASH[0] * paint.stroke, ASYMPTOTE_DASH[1] * paint.stroke])
    for (const [a, b] of at) {
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }
  } finally {
    ctx.setLineDash(prevDash)
    ctx.globalAlpha = prevAlpha
    ctx.restore()
  }
}

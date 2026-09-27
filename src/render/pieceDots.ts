// ============================================================================
// src/render/pieceDots.ts — the filled and open dots of a piecewise graph.
//
//     f(x) = { x² + 1   if x < 0          ○ at (0, 1)   the piece stops short
//            { 3        if 0 ≤ x ≤ 2      ● at (0, 3)   f(0) = 3
//            { −x + 5   if x > 2          nothing at (2, 3): the pieces join
//                                         there and the curve is unbroken
//
// Every textbook piecewise graph marks each piece's ends: a FILLED dot where
// the end is included, an OPEN one where it is not. Like a hole's ring (see
// src/render/holes.ts) this is not a figure convention — which of f(0) = 1 and
// f(0) = 3 is true is a fact about the function — so it is drawn in EVERY
// figure style, Screen included. The glyphs are the end caps' own
// (src/render/endCaps.ts drawEndDot), at the same sizes, in the curve's ink.
//
// THE RULES, in the order they are applied
//
//  1. Each FINITE piece end inside the curve's domain is evaluated with the
//     piece's own formula approached FROM INSIDE the piece — the one-sided
//     limit, because the parser's gated evaluator is NaN outside a piece. The
//     limit is taken by stepping in by h = 1e-9·max(1, |end|) and 2h and
//     extrapolating linearly (2·f(e ± h) − f(e ± 2h)); the two samples must
//     agree to within half a pixel, or the side runs away (ln x at 0⁺, 1/x)
//     and nothing is drawn. An ±Infinity side is never an end.
//  2. A CLOSED end is drawn filled at f(end), the value the graph actually
//     has there. Where that value is not where the piece's own stroke arrives
//     (⌊x⌋ closed at x = 3 has f(3) = 3 but arrives at 2) the arrival point
//     gets an open ring as well. A closed end whose formula has no value
//     there (sin x / x "closed" at 0) is, in fact, open: a ring at the limit.
//  3. Marks within 0.5 px of one another are ONE point. At such a point:
//       - CONTINUOUS JOIN — a piece arrives from the left, a different piece
//         leaves to the right, both arrive at this point, and some mark here
//         is filled: NOTHING is drawn. The curve is simply unbroken, and a
//         textbook draws no dot on an unbroken curve.
//       - otherwise any filled mark → one filled dot;
//       - otherwise → one open ring (x < 1 and x > 1: a hole at the join).
//  4. A ring within one dot radius of a filled dot is dropped — the filled
//     dot covers it — and a ring within one radius of a ring already kept is
//     the same ring.
//  5. A mark whose ink is wholly off the board is not drawn.
//
// The end-cap layer coordinates by position: an outermost end that sits on a
// piece end is flagged `piece` by curveEndPoints and an 'auto' cap there says
// nothing, so this layer's dot is the only one. A cap the teacher NAMED wins:
// the caller passes its position as `skip` and no piece mark goes there. The
// hole layer is told every point this layer marked (or deliberately left
// unmarked) so a hole at a piece end is not ringed a second time.
//
// A step INSIDE a piece (⌊x⌋ written as one piece on [−3, 3)) is not a piece
// end: the sampler finds it, and src/render/jumpDots.ts marks it. The sampler
// never reports a jump at a piece end, so the two layers cannot meet.
//
// Screen px throughout. FIGURE, not chrome: drawn with `chrome: null` too, so
// it reaches the exported PNG; sizes scale with `present.stroke`.
// ============================================================================

import type { FittedCurve, ModelSpec, Vec2, Viewport } from '../core/types'
import { ppuY, toMath, toScreen } from '../core/types'
import { END_DOT_R, curvePieces, drawEndDot, type EndDotPaint } from './endCaps'
import { oneSidedLimit } from './curves'

// The one-sided limit lives with the sampler now, which takes a JUMP's limits
// with it too (src/render/curves.ts analyzeJumps); re-exported so this layer's
// callers and tests keep asking it here.
export { oneSidedLimit }

/** Marks closer than this (screen px) are the same point. */
export const PIECE_SAME_PX = 0.5
/** How far past the visible x-range piece ends are looked at, as a fraction of it. */
const RANGE_PAD = 0.1

export interface PieceDot {
  /** Screen px. */
  at: Vec2
  /** Math coordinates. */
  x: number
  y: number
  /** Filled (the point is on the graph) or open (it is not). */
  closed: boolean
}

export interface PieceMarks {
  /** What is drawn, in draw order: every ring first, then every filled dot. */
  dots: PieceDot[]
  /**
   * Where two pieces join continuously and nothing is drawn, screen px — so
   * the hole layer can be told this point is spoken for, too.
   */
  joins: Vec2[]
}

/** One raw end before merging. */
interface Mark {
  at: Vec2
  x: number
  y: number
  closed: boolean
  /** Which end of its piece: the lower ('lo') or the upper ('hi'). */
  side: 'lo' | 'hi'
  piece: number
  /** The piece has width: its stroke actually arrives here from inside. */
  through: boolean
  /** This mark is where the piece's own stroke arrives (its one-sided limit). */
  arrival: boolean
}

/**
 * Every piece mark this curve carries on the board, merged by the rules in the
 * header. Null when the curve has no pieces (or is hidden, or not explicit, or
 * the viewport has no extent) — the signal that this layer does nothing.
 */
export function pieceMarks(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  vp: Viewport,
  stroke = 1,
): PieceMarks | null {
  if (!(vp.widthPx > 0) || !(vp.heightPx > 0) || !(vp.pxPerUnit > 0)) return null
  const pieces = curvePieces(curve, models)
  if (!pieces) return null
  const model = models[curve.modelId]
  if (!model || !model.evalExplicit) return null
  const params = curve.params
  const ev = (x: number): number => model.evalExplicit!(params, x)
  const ppy = ppuY(vp)

  // The visible x-range, padded, and the curve's own domain: an end outside
  // either is either never seen or never stroked.
  const left = toMath({ x: 0, y: 0 }, vp).x
  const right = toMath({ x: vp.widthPx, y: 0 }, vp).x
  const pad = (right - left) * RANGE_PAD
  let x0 = left - pad
  let x1 = right + pad
  const d = curve.domain
  if (d && Number.isFinite(d[0]) && Number.isFinite(d[1]) && d[1] > d[0]) {
    const eps = 1e-9 * Math.max(1, Math.abs(d[0]), Math.abs(d[1]))
    x0 = Math.max(x0, d[0] - eps)
    x1 = Math.min(x1, d[1] + eps)
  }

  const marks: Mark[] = []
  const push = (
    x: number, y: number, closed: boolean, side: 'lo' | 'hi', piece: number,
    through: boolean, arrival: boolean,
  ): void => {
    const at = toScreen({ x, y }, vp)
    if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return
    marks.push({ at, x, y, closed, side, piece, through, arrival })
  }

  pieces.forEach((p, i) => {
    const width = p.hi - p.lo
    const through = width > 0
    for (const side of ['lo', 'hi'] as const) {
      const e = side === 'lo' ? p.lo : p.hi
      if (!Number.isFinite(e) || e < x0 || e > x1) continue
      const closedAsked = side === 'lo' ? p.loClosed : p.hiClosed
      // A point piece {c if x = c} has no inside to approach from; it is its
      // value or nothing, and its two ends are the one point.
      if (!through) {
        if (side === 'hi') continue
        if (!(p.loClosed && p.hiClosed)) continue
        let v: number
        try { v = ev(e) } catch { continue }
        if (Number.isFinite(v)) push(e, v, true, 'lo', i, false, false)
        continue
      }
      const lim = oneSidedLimit(ev, e, side === 'lo' ? 1 : -1, width, ppy)
      if (closedAsked) {
        let v = Number.NaN
        try { v = ev(e) } catch { v = Number.NaN }
        if (Number.isFinite(v)) {
          const arrives = lim !== null && Math.abs(v - lim) * ppy <= PIECE_SAME_PX
          push(e, v, true, side, i, through, arrives)
          // The piece's stroke arrives somewhere else: that point is not on
          // the graph, and says so.
          if (!arrives && lim !== null) push(e, lim, false, side, i, through, true)
          continue
        }
        // "Closed" at a point the formula has no value: it is, in fact, open.
      }
      if (lim !== null) push(e, lim, false, side, i, through, true)
    }
  })
  if (marks.length === 0) return { dots: [], joins: [] }

  // Merge marks at the same point (single-linkage within PIECE_SAME_PX).
  const groups: Mark[][] = []
  for (const m of marks) {
    const g = groups.find((gr) =>
      gr.some((o) => Math.hypot(o.at.x - m.at.x, o.at.y - m.at.y) <= PIECE_SAME_PX))
    if (g) g.push(m)
    else groups.push([m])
  }

  const joins: Vec2[] = []
  const filled: PieceDot[] = []
  const open: PieceDot[] = []
  for (const g of groups) {
    const lead = g.find((m) => m.closed) ?? g[0]
    const hasClosed = g.some((m) => m.closed)
    const fromLeft = g.filter((m) => m.side === 'hi' && m.through && m.arrival)
    const toRight = g.filter((m) => m.side === 'lo' && m.through && m.arrival)
    const continuous =
      hasClosed && fromLeft.some((a) => toRight.some((b) => b.piece !== a.piece))
    if (continuous) {
      joins.push({ x: lead.at.x, y: lead.at.y })
      continue
    }
    const dot: PieceDot = { at: lead.at, x: lead.x, y: lead.y, closed: hasClosed }
    if (hasClosed) filled.push(dot)
    else open.push(dot)
  }

  // Rings the filled dots cover, and rings that are one ring.
  const cover = END_DOT_R * stroke
  const rings: PieceDot[] = []
  for (const r of open) {
    const near = (o: PieceDot): boolean => Math.hypot(o.at.x - r.at.x, o.at.y - r.at.y) <= cover
    if (filled.some(near) || rings.some(near)) continue
    rings.push(r)
  }

  // On the board when any of the glyph's ink is.
  const rad = cover
  const onBoard = (p: PieceDot): boolean =>
    p.at.x >= -rad && p.at.y >= -rad && p.at.x <= vp.widthPx + rad && p.at.y <= vp.heightPx + rad
  return {
    dots: [...rings.filter(onBoard), ...filled.filter(onBoard)],
    joins: joins.filter((j) => onBoard({ at: j, x: 0, y: 0, closed: true })),
  }
}

/**
 * Draw the piece marks. Rings go down first and filled dots on top, so a
 * filled dot a hair off a ring still covers it. `skip` is where a cap the
 * teacher NAMED already sits (screen px): the teacher's choice wins, and no
 * piece mark is stacked on it.
 *
 * Nothing to draw issues nothing — not even a save/restore pair.
 */
export function drawPieceDots(
  ctx: CanvasRenderingContext2D,
  dots: readonly PieceDot[],
  paint: EndDotPaint,
  skip: readonly Vec2[] = [],
): void {
  const tol = END_DOT_R * paint.stroke
  const at = dots.filter(
    (d) =>
      Number.isFinite(d.at.x) && Number.isFinite(d.at.y) &&
      !skip.some((s) => Math.hypot(s.x - d.at.x, s.y - d.at.y) <= tol),
  )
  if (at.length === 0) return
  ctx.save()
  try {
    // A dashed curve's dash would dash the rings; a dot is never dashed.
    if (typeof ctx.setLineDash === 'function') ctx.setLineDash([])
    for (const d of at) drawEndDot(ctx, d.at, d.closed, paint)
  } finally {
    ctx.restore()
  }
}

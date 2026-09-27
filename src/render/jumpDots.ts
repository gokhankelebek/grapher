// ============================================================================
// src/render/jumpDots.ts — the filled and open dots at a step function's jumps.
//
//     y = ⌊x⌋          ● at (n, n)   the step attains its left end
//                      ○ at (n, n−1) the step before stops short of it
//     y = sign x       ○ (0, −1)  ● (0, 0)  ○ (0, 1)
//     y = |x| / x      ○ (0, −1)  ○ (0, 1)   no value at 0 at all
//
// A typed piecewise line marks its piece ends (src/render/pieceDots.ts); a
// step function written as ONE formula — ⌊x⌋, ⌈x⌉, sign x, |x|/x, ⌊x/2⌋ + 1,
// x − ⌊x⌋ — has no pieces, and its jumps are found by the sampler instead:
// src/render/curves.ts breaks the stroke where a gap HOLDS its height, and
// analyzeJumps says, for each such break that is a finite step and not a
// pole, where it is (snapped to a nice number), its two one-sided limits and
// f there. This layer turns that into glyphs. Like a hole's ring and a
// piece's dot, which of f(0) = −1, 0 and 1 is true is a fact about the
// function, so it is drawn in EVERY figure style, Screen included, with the
// end caps' own glyphs (drawEndDot) at the same sizes, in the curve's ink.
//
// THE RULES, per jump
//
//  1. A jump whose x could not be snapped (`exact: false` — ⌊x²⌋ at √3) is
//     not marked: IEEE arithmetic cannot say which side f attains there, and
//     a filled dot on the wrong side would be a false statement.
//  2. f(x) within 0.5 px of one limit → a FILLED dot there and an OPEN ring at
//     the other limit (⌊x⌋, ⌈x⌉, x − ⌊x⌋).
//  3. f(x) matching neither → an OPEN ring at each limit, and a FILLED dot at
//     f(x) when it is finite (sign x at 0); none when it is not (|x|/x).
//  4. A ring within one dot radius of a filled dot is dropped (the dot covers
//     it); a ring within one radius of a ring already kept is the same ring.
//  5. A mark whose ink is wholly off the board is not drawn.
//
// Poles never reach here (analyzeJumps drops them), nor do piece ends (they
// are pieceDots'), nor the sampled span's own ends (the end caps'). The
// caller passes, as `skip`, every point another layer already marks there —
// a cap the teacher named, a piece dot — and tells the hole layer every point
// this one marks, so nothing is ever drawn twice.
//
// Screen px throughout. FIGURE, not chrome: drawn with `chrome: null` too, so
// it reaches the exported PNG; sizes scale with `present.stroke`.
// ============================================================================

import type { FittedCurve, ModelSpec, Viewport } from '../core/types'
import { ppuY, toScreen } from '../core/types'
import { type CurveJump, traceCurve } from './curves'
import { END_DOT_R } from './endCaps'
import { PIECE_SAME_PX, type PieceDot } from './pieceDots'

export { drawPieceDots as drawJumpDots } from './pieceDots'

/**
 * The dots for these jumps, by the rules in the header: every ring first,
 * then every filled dot (draw order — a dot covers a ring a hair off it).
 */
export function jumpMarks(
  jumps: readonly CurveJump[],
  vp: Viewport,
  stroke = 1,
): PieceDot[] {
  if (jumps.length === 0) return []
  if (!(vp.widthPx > 0) || !(vp.heightPx > 0) || !(vp.pxPerUnit > 0)) return []
  const ppy = ppuY(vp)
  const filled: PieceDot[] = []
  const open: PieceDot[] = []
  const add = (list: PieceDot[], x: number, y: number, closed: boolean): void => {
    if (!Number.isFinite(y)) return
    const at = toScreen({ x, y }, vp)
    if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return
    list.push({ at, x, y, closed })
  }
  for (const j of jumps) {
    if (!j.exact) continue
    if (!Number.isFinite(j.left) || !Number.isFinite(j.right)) continue
    const v = j.value
    const hasV = Number.isFinite(v)
    const onLeft = hasV && Math.abs(v - j.left) * ppy <= PIECE_SAME_PX
    const onRight = hasV && Math.abs(v - j.right) * ppy <= PIECE_SAME_PX
    if (onLeft && !onRight) {
      add(filled, j.x, v, true)
      add(open, j.x, j.right, false)
    } else if (onRight && !onLeft) {
      add(filled, j.x, v, true)
      add(open, j.x, j.left, false)
    } else {
      add(open, j.x, j.left, false)
      add(open, j.x, j.right, false)
      if (hasV) add(filled, j.x, v, true)
    }
  }

  const cover = END_DOT_R * stroke
  const dist = (a: PieceDot, b: PieceDot): number => Math.hypot(a.at.x - b.at.x, a.at.y - b.at.y)
  const rings: PieceDot[] = []
  for (const r of open) {
    if (filled.some((f) => dist(f, r) <= cover) || rings.some((o) => dist(o, r) <= cover)) continue
    rings.push(r)
  }
  const onBoard = (p: PieceDot): boolean =>
    p.at.x >= -cover && p.at.y >= -cover &&
    p.at.x <= vp.widthPx + cover && p.at.y <= vp.heightPx + cover
  return [...rings.filter(onBoard), ...filled.filter(onBoard)]
}

/**
 * The jump dots a curve carries on this board, sampling it afresh — for
 * callers that did not keep the jumps from their own paint pass (renderBoard
 * does, via drawCurve's `jumps` out-param, and calls `jumpMarks` directly).
 * Empty for a hidden, non-explicit or jump-free curve.
 */
export function curveJumpMarks(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  vp: Viewport,
  stroke = 1,
): PieceDot[] {
  if (!curve.visible || curve.kind !== 'explicit') return []
  let jumps: CurveJump[] = []
  try {
    jumps = traceCurve(curve, models, vp)?.jumps ?? []
  } catch {
    jumps = []
  }
  return jumpMarks(jumps, vp, stroke)
}

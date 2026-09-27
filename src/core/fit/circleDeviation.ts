// ============================================================================
// src/core/fit/circleDeviation.ts — how far a set of points is from a circle.
//
// One measure shared by the two places that ask "is this really a circle?":
// the recogniser, deciding between a circle and a polar family that is a
// circle in disguise (recognize.ts), and the board, deciding whether a
// sketched polar reading earns the polar ruling (ui/boardGrid.ts).
//
// Pure: no DOM, no canvas.
// ============================================================================

import type { Vec2 } from '../types'

/**
 * How far from a circle a shape may be and still BE a circle: the RMS of the
 * radial residual, as a fraction of the radius. A hand-drawn circle, wobble
 * and a little squash included, stays under it; a limaçon r = a + b·cos θ
 * crosses it at b/a ≈ 0.44 (b/a = ½, the edge of convexity, is at 3.9%), and
 * a dimpled limaçon, a cardioid, a rose or a spiral are far beyond. A spiral
 * r = a + b·θ drawn over one turn crosses it when it climbs ~17% of its
 * radius.
 */
export const CIRCLE_TOL = 0.03

/**
 * Relative RMS distance of `pts` from their best-fitting circle (Kåsa's
 * algebraic fit), or Infinity when there is no circle to speak of — too few
 * points, a degenerate spread, or everything at one spot.
 */
export function circleDeviation(pts: readonly Vec2[]): number {
  const n = pts.length
  if (n < 6) return Infinity
  // Centred first, so the normal equations are well conditioned far from the
  // origin.
  let mx = 0
  let my = 0
  for (const p of pts) {
    mx += p.x
    my += p.y
  }
  mx /= n
  my /= n
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0
  for (const p of pts) {
    const u = p.x - mx
    const v = p.y - my
    suu += u * u
    svv += v * v
    suv += u * v
    suuu += u * u * u
    svvv += v * v * v
    suvv += u * v * v
    svuu += v * u * u
  }
  const det = suu * svv - suv * suv
  if (!Number.isFinite(det) || Math.abs(det) <= 1e-18 * Math.max(1, suu * svv)) return Infinity
  const bu = (suuu + suvv) / 2
  const bv = (svvv + svuu) / 2
  const uc = (bu * svv - bv * suv) / det
  const vc = (bv * suu - bu * suv) / det
  const R = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n)
  if (!Number.isFinite(R) || R <= 0) return Infinity
  let ss = 0
  for (const p of pts) {
    const d = Math.hypot(p.x - mx - uc, p.y - my - vc) - R
    ss += d * d
  }
  return Math.sqrt(ss / n) / R
}

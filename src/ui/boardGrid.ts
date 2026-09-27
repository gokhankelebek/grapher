// ============================================================================
// src/ui/boardGrid.ts — which RULING a cartesian board is drawn on.
//
// A rose read off a square lattice is a picture of a rose. Read off circles
// and spokes it is a rose you can measure: r = 2cos(3θ) has petals of length 2
// and the circle labelled 2 is right there. The renderer has drawn both since
// a7a046b; this is the half that decides which one a board is on.
//
// It is a property of the BOARD, like the axis units and for the same reason:
// a polar lesson is a polar lesson on any machine, and a teacher who put the
// board back on squares must find it on squares tomorrow.
//
// The one thing this does NOT do is decide for anybody. `suggestPolarRuling`
// is a recommendation the App offers in a line at the foot of the board with
// one tap to accept — a board that silently re-ruled itself under a curve
// mid-lesson would be the worst possible moment for a surprise.
//
// Pure: no React, no DOM, no canvas.
// ============================================================================

import type { FittedCurve, Vec2 } from '../core/types'
import { MODELS } from '../core/fit/models'
import type { BoardGrid } from '../core/persist'

export type { BoardGrid }

/** The two rulings, in the order the control shows them. */
export const RULINGS: ReadonlyArray<{ value: BoardGrid; label: string; title: string }> = [
  {
    value: 'cartesian',
    label: 'Square',
    title: 'The square lattice: x across, y up',
  },
  {
    value: 'polar',
    label: 'Polar',
    title: 'Circles of constant r and spokes of constant θ — how a polar curve is read',
  },
]

/**
 * The curve families that are POLAR — the ones whose equation is r in terms
 * of θ, and which therefore have a natural reading on circles and spokes.
 *
 * A fitted rose, limaçon or spiral is self-identifying by family. A typed
 * `r = 2cos(3θ)` is not: its family is `expr_N`, and what says it is polar is
 * the kind the parser gave it — which is on the curve itself.
 */
const POLAR_MODELS = new Set(['polarRose', 'limacon', 'spiral'])

/**
 * How far from a circle a SKETCHED polar reading may be and still be a circle:
 * the RMS of the radial residual, as a fraction of the radius. A hand-drawn
 * circle, wobble and a little squash included, stays under it; a limaçon at
 * the edge of convexity (b/a = ½) is already past it, and a dimpled limaçon,
 * a cardioid, a rose or a spiral are far beyond.
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

/** The fitted polar reading, sampled into the plane. */
function samplePolar(curve: FittedCurve): Vec2[] {
  const spec = MODELS[curve.modelId]
  if (!spec || !spec.evalPolar) return []
  const d = curve.domain
  const lo = d && Number.isFinite(d[0]) ? d[0] : 0
  const hi = d && Number.isFinite(d[1]) && d[1] > lo ? d[1] : lo + 2 * Math.PI
  const out: Vec2[] = []
  const N = 180
  for (let i = 0; i < N; i++) {
    const t = lo + ((hi - lo) * i) / N
    const r = spec.evalPolar(curve.params, t)
    if (!Number.isFinite(r)) continue
    out.push({ x: r * Math.cos(t), y: r * Math.sin(t) })
  }
  return out
}

/**
 * A SKETCHED curve the recogniser read in a polar family that is, on the
 * board, a circle.
 *
 * A circle drawn near the origin is a perfectly good rose with k = 1
 * (r = a·cos(θ + c) is a circle through the pole), a limaçon with a tiny b, or
 * a spiral that barely climbs — and the recogniser picks whichever of those
 * fits the ink best. None of that makes it a polar lesson: the teacher drew a
 * circle. So a fitted polar family counts only when the READING is not a
 * circle and the INK was not a circle either.
 */
export function isSketchedCircle(curve: FittedCurve): boolean {
  if (!POLAR_MODELS.has(curve.modelId)) return false
  if (curve.modelId === 'polarRose' && Math.round(Math.abs(curve.params[1] ?? 0)) === 1) {
    // r = a·cos(θ + c): a circle through the pole, of diameter |a|.
    return Math.abs(curve.params[0] ?? 0) > 0
  }
  if (circleDeviation(samplePolar(curve)) <= CIRCLE_TOL) return true
  const ink = curve.sourceStroke
  return Array.isArray(ink) && circleDeviation(ink) <= CIRCLE_TOL
}

/**
 * Is this curve POLAR — an equation in r and θ that a class reads off circles
 * and spokes?
 *
 * A typed `r = …` always is: the teacher wrote it in polar, whatever shape it
 * draws. A sketched rose, limaçon or spiral is — unless it is a circle that
 * the recogniser happened to read in a polar family (isSketchedCircle). A
 * circle or ellipse fit (implicit) never is.
 */
export function isPolarCurve(curve: FittedCurve): boolean {
  if (POLAR_MODELS.has(curve.modelId)) return !isSketchedCircle(curve)
  return curve.kind === 'polar'
}

/**
 * Should this board be OFFERED the polar ruling?
 *
 * True exactly when something visible on it is polar. Deliberately shaped
 * like `suggestAxisUnits` — a recommendation, re-asked whenever the curve set
 * changes, never a decision.
 */
export function suggestPolarRuling(curves: readonly FittedCurve[]): boolean {
  for (const c of curves) {
    if (!c.visible) continue
    if (isPolarCurve(c)) return true
  }
  return false
}

/** How a toast names the ruling it is offering. */
export const POLAR_OFFER =
  'That curve is polar. Rule the board in circles and spokes?'

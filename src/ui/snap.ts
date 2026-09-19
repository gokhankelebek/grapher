// ============================================================================
// src/ui/snap.ts — where a point PUT DOWN WITH A FINGER lands.
//
// A tap on the board used to place a slope field's initial condition at
// (−0.041667, 1.975). That is an honest reading of the pixel the pointer was
// over and a useless thing to write on a card: nobody means −0.041667, and a
// class copying it down is copying noise. A coordinate a teacher TYPES is
// exact and stays exact; a coordinate a POINTER produces is a gesture at a
// place, and a gesture wants the nearest nice number.
//
// The ladder is the grid's own (src/render/grid.ts, pickTickStep), so the
// snap tightens exactly when the board does: zoom in and the step follows the
// ticks down. One tenth of the major step is the rung — fine enough that the
// point lands where the finger was, coarse enough that what lands is a number
// with one digit after the point at ordinary zoom.
//
// Pure: no React, no DOM, no canvas.
// ============================================================================

import type { Vec2, Viewport } from '../core/types'
import { pickTickStep } from '../render/grid'

/**
 * The rung a pointer-placed coordinate lands on, in math units.
 *
 * A tenth of the major tick step, which at the default zoom (major = 2) is
 * 0.2 and at a screen zoomed in on the unit square is 0.05 — always a round
 * number in the units the axis is currently labelled in, because it comes off
 * the same 1–2–5 ladder the labels do.
 */
export function snapStep(vp: Viewport): number {
  const ppu = vp && Number.isFinite(vp.pxPerUnit) && vp.pxPerUnit > 0 ? vp.pxPerUnit : 60
  const step = pickTickStep(ppu).major / 10
  return Number.isFinite(step) && step > 0 ? step : 0.1
}

/**
 * One coordinate, snapped to the ladder.
 *
 * The division is re-rounded at 1e-9 because `Math.round(1.975 / 0.2) * 0.2`
 * is 2.0000000000000004, and a card that prints that has lost the entire
 * point of snapping.
 */
export function snapCoord(v: number, vp: Viewport): number {
  if (!Number.isFinite(v)) return v
  const step = snapStep(vp)
  const snapped = Math.round(v / step) * step
  if (!Number.isFinite(snapped)) return v
  const clean = Math.round(snapped * 1e9) / 1e9
  return clean === 0 ? 0 : clean
}

/**
 * A point placed or dragged by a pointer, snapped to the ladder.
 *
 * Every pointer path goes through here — a field's initial condition, a
 * shape's vertex — so there is one rule for "where did my finger put it"
 * rather than one per object.
 */
export function snapPlaced(p: Vec2, vp: Viewport): Vec2 {
  return { x: snapCoord(p.x, vp), y: snapCoord(p.y, vp) }
}

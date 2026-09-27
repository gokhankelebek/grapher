// ============================================================================
// src/ui/intersections.ts — where the curves on this board MEET.
//
// An intersection is the one feature on a graph that does not belong to a
// curve. "Where does f cross g?" is a question about a PAIR, which is why it
// cannot live in the per-curve analysis the rest of the board is built from:
// the point has two parents, it is drawn once for both of them, and both cards
// have to list it or a student reading g's card is missing the answer to a
// question that was asked about g.
//
// So the pairing lives here, between the App (which owns the curve list and
// the window) and the renderer (which owns the glyph). The mathematics is
// core's: src/core/analyze.ts intersectionPoints() finds the meetings and
// verifies the closed forms. Nothing in this file decides where a point IS.
//
// Pure: no React, no DOM, no canvas — so the memo key, the pair cap and the
// per-card grouping are all testable without a browser.
// ============================================================================

import type { FittedCurve, ModelSpec, SpecialPoint } from '../core/types'
import { intersectionPoints } from '../core/analyze'
import type { BoardIntersection } from './renderBoard'
import type { CalcLink } from '../core/persist'

export type { BoardIntersection }

/**
 * How many PAIRS are ever solved for one frame.
 *
 * Pairs grow as n²: six curves is fifteen root hunts, eight is twenty-eight,
 * and every one of them re-runs when a slider moves. Eight pairs is four
 * curves fully crossed — past that the board is not a lesson about where two
 * graphs meet, and the ones kept are the first ones in sidebar order, which
 * are the curves the teacher put down first.
 */
export const MAX_PAIRS = 8

/** Fraction of the window added to each side, so a chip just off-screen is found. */
const PAD = 0.25

/**
 * The x-range intersections are hunted over: the visible window, padded, with
 * both ends SNAPPED OUTWARD to a coarse grid.
 *
 * The snap is the whole point. Without it every frame of a pan is a new range,
 * a new memo key and a fresh root hunt for every pair on the board — which is
 * exactly the cost this feature must not have. A quarter of a window is the
 * grid, so a pan only re-solves once the board has genuinely moved somewhere
 * new, and the padding means the points near the edge were already found.
 */
export function intersectionSpan(window: readonly [number, number]): [number, number] {
  const a = Math.min(window[0], window[1])
  const b = Math.max(window[0], window[1])
  if (!Number.isFinite(a) || !Number.isFinite(b)) return [-10, 10]
  const w = Math.max(1e-6, b - a)
  const step = Math.pow(2, Math.ceil(Math.log2(w / 4)))
  const lo = a - w * PAD
  const hi = b + w * PAD
  return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step]
}

/**
 * A curve that can be crossed: any visible curve. Functions of x, implicit
 * curves (a sketched circle or ellipse, a typed conic), parametric and polar
 * curves are all met in the plane by intersectionPoints — a circle and a
 * parabola used to show no crossings at all because only y = f(x) pairs were
 * ever asked.
 */
export function crossable(c: FittedCurve): boolean {
  return (
    c.visible &&
    (c.kind === 'explicit' || c.kind === 'implicit' || c.kind === 'parametric' || c.kind === 'polar')
  )
}

/**
 * Everything a set of intersections depends on, as one string.
 *
 * The identity of the curve array is not it: a slider drag rebuilds the array
 * on every frame with the same numbers in it, and a pan rebuilds nothing at
 * all while moving the window the points are hunted in. What actually moves an
 * intersection is a parameter, a domain, the set of curves, and the range —
 * so those are what the key is made of.
 */
export function intersectionKey(
  curves: readonly FittedCurve[],
  span: readonly [number, number],
  /**
   * curveId -> the state of the curves a typed line CALLS (nameLinks'
   * dependencyKeys): g = 2f(x − 1) + 3 moves when f's slider does, with its
   * own params untouched. Absent: nothing calls anything.
   */
  deps?: Readonly<Record<string, string>>,
): string {
  const parts: string[] = []
  for (const c of curves) {
    if (!crossable(c)) continue
    const dep = deps?.[c.id]
    parts.push(
      `${c.id}:${c.modelId}:${c.params.join(',')}:${c.domain ? c.domain.join(',') : ''}${
        dep ? `:${dep}` : ''
      }`,
    )
  }
  return `${parts.join('|')}#${span[0]},${span[1]}`
}

/** One unordered pair of curve ids, as a set key. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/**
 * A curve and its own Taylor polynomial are not a pair to solve. They agree
 * to order n at the centre — the centre handle already marks that point —
 * and the solver, handed a difference that is flat to 1e-15 around it,
 * reports crossings that are only rounding (f and P₅ of sin "met" at
 * 0.001126). Where they part far from the centre is the error, which the
 * card and the band say better than a chip does.
 */
export function taylorApart(calc: readonly CalcLink[]): Set<string> {
  const out = new Set<string>()
  for (const l of calc) if (l.kind === 'taylor') out.add(pairKey(l.parentId, l.curveId))
  return out
}

/**
 * The pairs this board solves, each ordered (a, b) with a first in sidebar
 * order — so the pair (f, g) is asked ONCE and never again as (g, f).
 */
export function intersectionPairs(
  curves: readonly FittedCurve[],
  apart?: ReadonlySet<string>,
): [FittedCurve, FittedCurve][] {
  const open = curves.filter(crossable)
  const out: [FittedCurve, FittedCurve][] = []
  for (let i = 0; i < open.length; i++) {
    for (let j = i + 1; j < open.length; j++) {
      if (out.length >= MAX_PAIRS) return out
      if (apart?.has(pairKey(open[i].id, open[j].id))) continue
      out.push([open[i], open[j]])
    }
  }
  return out
}

/**
 * Every meeting point on the board, once each.
 *
 * `curveId` is the curve the analyzer was asked about and `point.withId` is
 * the other one, so the pair is recoverable from the entry alone — which is
 * what lets both cards list a point that was computed a single time.
 */
export function boardIntersections(
  curves: readonly FittedCurve[],
  models: Record<string, ModelSpec>,
  span: readonly [number, number],
  /** pairs never solved (pairKey): see taylorApart */
  apart?: ReadonlySet<string>,
): BoardIntersection[] {
  const range: [number, number] = [span[0], span[1]]
  const out: BoardIntersection[] = []
  for (const [a, b] of intersectionPairs(curves, apart)) {
    let pts: SpecialPoint[] = []
    try {
      const got = intersectionPoints(a, b, models, range)
      pts = Array.isArray(got) ? got : []
    } catch {
      // A pair the solver cannot do is a pair with no answer, never a board
      // that fails to draw.
      pts = []
    }
    for (const p of pts) {
      if (!p || !p.pos || !Number.isFinite(p.pos.x) || !Number.isFinite(p.pos.y)) continue
      out.push({ curveId: a.id, point: p.withId === b.id ? p : { ...p, withId: b.id } })
    }
  }
  return out
}

/** One other curve, named, and where this curve meets it. */
export interface CurveIntersections {
  /** The OTHER curve's id. */
  id: string
  /** What the other curve is called on this board — "g", or its card's label. */
  name: string
  points: SpecialPoint[]
}

/**
 * What ONE card lists: the same points, read from this curve's side.
 *
 * A meeting point is a point — it has the same coordinates whichever curve is
 * asked — so an entry computed as (f, g) answers g's card too, with f as the
 * other curve. That is why the cards never disagree: there is one list.
 */
export function cardIntersections(
  curveId: string,
  all: readonly BoardIntersection[],
  nameOf: (id: string) => string,
  order: readonly string[] = [],
): CurveIntersections[] {
  const byOther = new Map<string, SpecialPoint[]>()
  for (const m of all) {
    const other =
      m.curveId === curveId ? m.point.withId : m.point.withId === curveId ? m.curveId : undefined
    if (typeof other !== 'string' || other === '' || other === curveId) continue
    const list = byOther.get(other)
    if (list) list.push(m.point)
    else byOther.set(other, [m.point])
  }
  if (byOther.size === 0) return []
  const rank = new Map(order.map((id, i) => [id, i]))
  const out: CurveIntersections[] = []
  for (const [id, points] of byOther) {
    out.push({
      id,
      name: nameOf(id),
      // Left to right, the way every other row of the table reads.
      points: points.slice().sort((p, q) => p.pos.x - q.pos.x),
    })
  }
  out.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
  return out
}

/**
 * How close two points must be to be ONE place on the board, as a fraction of
 * the span the crossings are hunted over. A millionth of the window is far
 * below a pixel at any zoom the board allows, and far above the round-off
 * between a vertex found by one solver and a crossing found by another.
 */
export const SAME_SPOT = 1e-6

/**
 * The crossings the board should DRAW, given the markers already standing
 * there.
 *
 * A circle's lowest point that is also where the parabola touches it, a
 * vertex on the line through it: the analysis layer marks and labels that
 * place for the selected curve, and the crossing layer would put a second,
 * identical chip beside it. One place gets one chip, so the crossing YIELDS:
 * its diamond and chip are dropped where an analysis marker already sits, and
 * the analysis marker keeps its glyph, its chip and everything the pointer can
 * do with it (hover from the card, click to edit). renderBoard has no switch
 * for "a diamond without its chip", and a marker taken out of the analysis
 * list would shift every index the card and the board address it by.
 *
 * The crossing is still on both CARDS — this is the board's list, not the
 * list cardIntersections reads — and it comes back the moment the selection
 * moves to a curve without a marker there.
 *
 * Returns `all` itself when nothing is dropped, so a memo downstream sees the
 * same array.
 */
export function crossingsClearOf(
  all: readonly BoardIntersection[],
  marks: readonly SpecialPoint[],
  span: readonly [number, number],
): readonly BoardIntersection[] {
  if (all.length === 0 || marks.length === 0) return all
  const width = Math.abs(span[1] - span[0])
  const tol = SAME_SPOT * Math.max(1, Number.isFinite(width) ? width : 1)
  const at = marks.filter(
    (m) => m && m.pos && Number.isFinite(m.pos.x) && Number.isFinite(m.pos.y),
  )
  if (at.length === 0) return all
  const kept = all.filter(
    (c) =>
      !at.some(
        (m) => Math.abs(m.pos.x - c.point.pos.x) <= tol && Math.abs(m.pos.y - c.point.pos.y) <= tol,
      ),
  )
  return kept.length === all.length ? all : kept
}

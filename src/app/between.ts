// ============================================================================
// src/app/between.ts — "area between curves": how a teacher says which second
// curve they mean. Pure decisions, tested on their own (tests import them
// through App.tsx, which re-exports them).
// ============================================================================

import type { FittedCurve, ModelSpec } from '../core/types'
import { fixed as fixedNum } from '../ui/calcLinks'
import type { CalcLink } from '../ui/calcLinks'
import type { BetweenInfo } from '../ui/CurveCard'

// ---------------------------------------------------------------- between two
//
// "Area between curves" is one AreaLink with a second curve named in it. The
// mathematics is core's; what the App decides is only how a teacher SAYS which
// second curve they mean, and those decisions are pure — so they live here,
// out of the component, where they can be stated and tested on their own.

/**
 * A fresh area between curves reads |f − g|, not the signed integral.
 *
 * The axis case defaults the other way on purpose: ∫f dx is the thing an AP
 * class is learning to read, sign and all. But "the area between two curves"
 * IS ∫|f − g| — top minus bottom wherever they cross — and a region a teacher
 * can see must never open reading 0.000 because its halves cancelled. The
 * signed integral is still one chip away.
 */
export const BETWEEN_ABS = true

/** What the board says when nobody picked a second curve after all. */
export const BETWEEN_CANCELLED = 'No second curve picked.'

/** Which curves a region on `parentId` could run to: another, on screen, of x. */
export function betweenTargets(
  curves: readonly FittedCurve[],
  models: Record<string, ModelSpec>,
  parentId: string,
): FittedCurve[] {
  return curves.filter(
    (c) => c.id !== parentId && c.visible && models[c.modelId]?.kind === 'explicit',
  )
}

/**
 * What "Area between curves…" does next.
 *
 * With exactly one other curve on the board there is no question to ask — the
 * teacher meant that one, and asking would be a click spent confirming what
 * everyone can see. With two or more, the next tap answers it. With none there
 * is no answer at all, so the offer turns into the reason.
 */
export type BetweenIntent =
  | { act: 'refuse'; say: string }
  | { act: 'create'; otherId: string }
  | { act: 'arm'; say: string }

export function betweenIntent(
  curves: readonly FittedCurve[],
  models: Record<string, ModelSpec>,
  parentId: string,
): BetweenIntent {
  const parent = curves.find((c) => c.id === parentId)
  if (!parent || models[parent.modelId]?.kind !== 'explicit') {
    return { act: 'refuse', say: 'Only a curve that is a function of x can carry calculus objects.' }
  }
  const targets = betweenTargets(curves, models, parentId)
  if (targets.length === 0) return { act: 'refuse', say: 'Draw or type a second curve first.' }
  if (targets.length === 1) return { act: 'create', otherId: targets[0].id }
  return { act: 'arm', say: 'Tap the second curve.' }
}

/** "−1.5", not "−1.50" — the number a teacher would have said out loud. */
export function sayX(v: number): string {
  const s = fixedNum(v, 2)
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s
}

/**
 * How a new region introduces itself.
 *
 * Two sentences, because they ask for two different next moves. Bounds that
 * came from where the curves MEET are almost always the region the question
 * is about, and saying so is what stops a teacher hunting for the handles they
 * do not need. Bounds that came from nothing of the sort say exactly that, and
 * name the two chips that fix it.
 */
export function betweenNotice(hits: number, from: number, to: number): string {
  return hits >= 2
    ? `Shaded between the curves from x = ${sayX(from)} to x = ${sayX(to)} (where they meet)`
    : 'No intersection in view — drag a and b to set the region'
}

/**
 * The between-curves facts every card needs, in one pass.
 *
 * Neither is about a curve's own links, which is why they are not in CardCalc:
 * `canAdd` is a question about the BOARD (is there a second curve to point
 * at?), and `notes` is what a curve is owed when it is the far side of a
 * region some OTHER card owns.
 */
export function betweenCardInfo(
  curves: readonly FittedCurve[],
  models: Record<string, ModelSpec>,
  links: readonly CalcLink[],
  nameOf: (curve: FittedCurve) => string,
): Record<string, BetweenInfo> {
  const out: Record<string, BetweenInfo> = {}
  const usable = (c: FittedCurve): boolean =>
    c.visible && models[c.modelId]?.kind === 'explicit'
  const pool = curves.filter(usable).length
  for (const c of curves) {
    // There has to be at least one OTHER curve the region could run to.
    const others = pool - (usable(c) ? 1 : 0)
    out[c.id] = { canAdd: models[c.modelId]?.kind === 'explicit' && others > 0, notes: [] }
  }
  const byId = new Map(curves.map((c) => [c.id, c]))
  for (const l of links) {
    if ((l.kind !== 'area' && l.kind !== 'volume' && l.kind !== 'polarbetween') || !l.otherId) continue
    const parent = byId.get(l.parentId)
    const here = out[l.otherId]
    if (!parent || !here) continue
    const name = nameOf(parent)
    here.notes.push(
      l.kind === 'volume'
        ? `solid on the region between this and ${name} \u2014 see ${name}\u2019s card`
        : l.kind === 'polarbetween'
          ? `polar area between this and ${name} \u2014 see ${name}\u2019s card`
          : `area between this and ${name} \u2014 see ${name}\u2019s card`,
    )
  }
  return out
}

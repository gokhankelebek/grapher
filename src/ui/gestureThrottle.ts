// ============================================================================
// src/ui/gestureThrottle.ts — expensive derived values during a live gesture.
//
// A slider drag or a handle drag changes a curve on every frame, and some of
// what the board derives from the curves is too dear to redo sixty times a
// second on a school Chromebook: the crossings of every pair of curves (a root
// hunt per pair) and the special points of the selected curve. Those stay
// value-keyed memos — the key says WHEN the answer could have changed — but
// while a gesture is in progress the key they are handed is a THROTTLED copy
// of the live one:
//
//   * a recomputation that is cheap runs every frame, exactly as before;
//   * one that is dear waits until a few times its own cost has passed since
//     the last run, so it never takes more than a fixed share of the frames;
//   * a pause mid-drag still gets the latest answer (a trailing timer), and
//   * the moment the gesture ends the live key goes straight through — the
//     final pass on release, so the resting board is always exact.
//
// The decision is pure (GestureThrottle) so it is testable without React; the
// hook (useGestureKey) only adds the trailing timer and the re-render.
// ============================================================================

import { useEffect, useReducer, useRef } from 'react'

export interface ThrottleOpts {
  /** Never recompute more often than this while busy (ms). */
  minGapMs: number
  /** While busy, wait at least `factor` × the last run's cost between runs. */
  factor: number
  /** ...but never longer than this, however dear a run was (ms). */
  maxGapMs: number
}

/**
 * Special points of the dragged curve: at most ~30 times a second, and never
 * more than a quarter of the time on a slow machine. The markers trail the
 * curve by a frame or two mid-drag and are exact the moment it is let go.
 */
export const ANALYSIS_THROTTLE: ThrottleOpts = { minGapMs: 32, factor: 4, maxGapMs: 150 }
/** Pairwise crossings: a root hunt per pair — ~20 times a second at most, ≤ 1/6 of the time. */
export const CROSSINGS_THROTTLE: ThrottleOpts = { minGapMs: 50, factor: 6, maxGapMs: 250 }

/**
 * When a value-keyed recomputation may run. Not busy: always, now. Busy: once
 * the gap its own measured cost buys has passed since the last run.
 */
export class GestureThrottle {
  private lastRun = Number.NEGATIVE_INFINITY
  private lastCost = 0

  constructor(readonly opts: ThrottleOpts) {}

  /** The wait required after the last run while a gesture is in progress. */
  gap(): number {
    const { minGapMs, factor, maxGapMs } = this.opts
    return Math.min(maxGapMs, Math.max(minGapMs, this.lastCost * factor))
  }

  /** 0 = run now; otherwise how many ms until it may run. */
  wait(now: number, busy: boolean): number {
    if (!busy) return 0
    const left = this.lastRun + this.gap() - now
    return left > 0 ? left : 0
  }

  /** Record a run that started at `start` and cost `costMs`. */
  ran(start: number, costMs: number): void {
    this.lastRun = start
    this.lastCost = Number.isFinite(costMs) && costMs > 0 ? costMs : 0
  }
}

/**
 * The key a memo should be keyed on: `live` itself when no gesture is in
 * progress, and otherwise the last key the throttle let through — advanced as
 * soon as it allows, and by a trailing timer when the pointer stops moving.
 *
 * The memo that uses it reports its own cost through `throttle.ran()`.
 */
export function useGestureKey(live: string, busy: boolean, throttle: GestureThrottle): string {
  const settled = useRef(live)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [, bump] = useReducer((n: number) => n + 1, 0)

  if (settled.current !== live) {
    const left = throttle.wait(now(), busy)
    if (left <= 0) {
      settled.current = live
      if (timer.current !== null) {
        clearTimeout(timer.current)
        timer.current = null
      }
    } else if (timer.current === null) {
      timer.current = setTimeout(() => {
        timer.current = null
        bump()
      }, Math.ceil(left))
    }
  }

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = null
    },
    [],
  )
  return settled.current
}

/** Time a recomputation and tell the throttle what it cost. */
export function timed<T>(throttle: GestureThrottle, fn: () => T): T {
  const start = now()
  try {
    return fn()
  } finally {
    throttle.ran(start, now() - start)
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

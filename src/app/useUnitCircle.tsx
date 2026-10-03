// ============================================================================
// src/app/useUnitCircle.tsx — the unit circle: θ, the inverse question, the animation and its cards.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { dragTheta, inverseTrig } from '../core/trig'
import type { InvFn, UnwrapFn } from '../core/trig'
import { CURVE_COLORS, nextId, ppuX } from '../core/types'
import type { Vec2 } from '../core/types'
import type { UnitCircleFigure } from '../render/unitCircle'
import type { ExtraHandle } from '../ui/CanvasStage'
import { UnitCircleCard } from '../ui/UnitCircleCard'
import {
  newUnitCircle,
  playStart,
  playStep,
  settleTheta,
  unitCircleBox,
  unitCircleCard,
  unitCircleFigure,
} from '../ui/unitCircleLinks'
import type { BoardUnitCircle, UnitCircleShow } from '../ui/unitCircleLinks'
import type { BoardStateApi } from './useBoardState'
import type { BoardRefsApi } from './useBoardRefs'
import type { ModelsApi } from './useModels'
import type { NoticesApi } from './useNotices'
import type { HistoryApi } from './useHistory'
import type { CalcLinksApi } from './useCalcLinks'
import type { ViewportApi } from './useViewport'
import { playClock } from '../ui/motionPref'

/** What useUnitCircle reads from the hooks App calls before it. */
export interface UnitCircleDeps {
  board: BoardStateApi
  refs: BoardRefsApi
  derived: ModelsApi
  notices: NoticesApi
  history: HistoryApi
  calc: CalcLinksApi
  viewport: ViewportApi
}

export function useUnitCircle({ board, refs, derived, notices, history, calc, viewport }: UnitCircleDeps) {
  const {
    kind, selectedId, setSelectedId, unitCircles, ucPlay, setUcPlay, ucPlayRef, ucSpeed, setUcSpeed,
  } = board
  const { kindRef, selectedRef, preEditRef, ucRef } = refs
  const { vpRef } = derived
  const { showToast } = notices
  const { applyState, commitState, undo } = history
  const { selectObject } = calc
  const { frameBox } = viewport

  // ============================================================ unit circle
  //
  // One per board. The document holds the centre, θ, the switches and the
  // inverse question (src/core/persist.ts BoardUnitCircle); every exact value,
  // label and polyline the board and the card show is re-derived from those
  // (src/ui/unitCircleLinks.ts), so nothing drawn can go stale.

  /** One circle, replaced in place, with cleared optional keys REMOVED (not undefined). */
  const mapUC = useCallback(
    (id: string, patch: Partial<BoardUnitCircle>): BoardUnitCircle[] =>
      ucRef.current.map((u) => {
        if (u.id !== id) return u
        const next: BoardUnitCircle = { ...u, ...patch }
        for (const k of ['deg', 'unwrap', 'inv', 'hidden'] as const) {
          if (k in patch && patch[k] === undefined) delete next[k]
        }
        return next
      }),
    [],
  )

  /**
   * One stated change to the unit circle. `live` is a drag in flight: the
   * state moves without a history entry of its own, inside the bracket the
   * gesture opened, so a drag of P round the circle is ONE undo.
   */
  const patchUnitCircle = useCallback(
    (id: string, patch: Partial<BoardUnitCircle>, label: string, live = false): void => {
      if (!ucRef.current.some((u) => u.id === id)) return
      const next = mapUC(id, patch)
      if (live) applyState({ unitCircles: next })
      else commitState({ unitCircles: next }, label)
    },
    [applyState, commitState, mapUC],
  )

  const ucSpeedRef = useRef(ucSpeed)
  ucSpeedRef.current = ucSpeed

  /**
   * Where a pause left θ. Play resumes from there only while θ is still
   * exactly that; any other θ (dragged, typed, a finished turn) plays the
   * whole unwrapping again from 0.
   */
  const ucPausedRef = useRef<number | null>(null)

  /** Stop the animation, leaving θ where it got to — one undo takes it back. */
  const stopUnitCirclePlay = useCallback((): void => {
    const cur = ucPlayRef.current
    if (!cur) return
    ucPlayRef.current = null
    setUcPlay(null)
    const theta = settleTheta(cur.theta)
    ucPausedRef.current = theta
    // The circle that was PLAYING — not whichever happens to be first.
    const u = ucRef.current.find((c) => c.id === cur.id)
    if (u) patchUnitCircle(u.id, { theta }, 'play θ')
  }, [patchUnitCircle])

  /** Build ▾ → Unit circle: put it on the board, or select the one already there. */
  const addUnitCircle = useCallback((): void => {
    if (kindRef.current !== 'cartesian') return
    const have = ucRef.current[0]
    if (have) {
      setSelectedId(have.id)
      showToast('This board already has its unit circle — it is selected.', { ms: 2600 })
      return
    }
    const uc = newUnitCircle(nextId())
    commitState({ unitCircles: [...ucRef.current, uc] }, 'add unit circle')
    setSelectedId(uc.id)
    // Frame the circle AND the room to its right where sin x unwraps.
    frameBox(unitCircleBox(uc, true))
  }, [commitState, frameBox, showToast])

  const deleteUnitCircle = useCallback(
    (id: string): void => {
      if (!ucRef.current.some((u) => u.id === id)) return
      ucPlayRef.current = null
      setUcPlay(null)
      commitState({ unitCircles: ucRef.current.filter((u) => u.id !== id) }, 'delete unit circle')
      showToast('Deleted the unit circle. Undo brings it back.', {
        action: { label: 'Undo', run: () => undo() },
      })
      setSelectedId((sel) => (sel === id ? null : sel))
    },
    [commitState, showToast, undo],
  )

  const zoomToUnitCircle = useCallback(
    (id: string): void => {
      const u = ucRef.current.find((c) => c.id === id)
      if (u) frameBox(unitCircleBox(u))
    },
    [frameBox],
  )

  const setUnitCircleTheta = useCallback(
    (id: string, theta: number): void => {
      if (!Number.isFinite(theta)) return
      ucPlayRef.current = null
      setUcPlay(null)
      patchUnitCircle(id, { theta }, 'set θ')
    },
    [patchUnitCircle],
  )

  const setUnitCircleInverse = useCallback(
    (id: string, inv: { fn: InvFn; v: number } | null): void => {
      if (!inv) {
        patchUnitCircle(id, { inv: undefined }, 'clear inverse')
        return
      }
      const out = inverseTrig(inv.fn, inv.v)
      ucPlayRef.current = null
      setUcPlay(null)
      // θ goes to the principal answer: P and the answer are the same point.
      patchUnitCircle(id, out.ok ? { inv, theta: out.principal } : { inv }, `${inv.fn}⁻¹`)
    },
    [patchUnitCircle],
  )

  const playUnitCircle = useCallback(
    (id: string, on: boolean): void => {
      const u = ucRef.current.find((c) => c.id === id)
      if (!u) return
      if (!on) {
        stopUnitCirclePlay()
        return
      }
      const paused = ucPausedRef.current
      const start = { id: u.id, theta: paused !== null && paused === u.theta ? playStart(u.theta) : 0 }
      ucPlayRef.current = start
      setUcPlay(start)
    },
    [stopUnitCirclePlay],
  )

  // The animation: requestAnimationFrame only while playing; a hidden tab
  // stops it (and keeps θ where it got to).
  const ucPlaying = ucPlay !== null
  useEffect(() => {
    if (!ucPlaying) return
    let raf = 0
    // Reduced motion: Play advances in half-second steps instead of gliding.
    const clock = playClock(performance.now())
    const tick = (now: number): void => {
      const dt = clock(now)
      if (dt === null) {
        raf = requestAnimationFrame(tick)
        return
      }
      const cur = ucPlayRef.current
      if (!cur) return
      if (!ucRef.current.some((c) => c.id === cur.id)) {
        // The circle is gone (an undo took it off the board): nothing is
        // playing any more, and the card must not stay on ■.
        ucPlayRef.current = null
        setUcPlay(null)
        return
      }
      const step = playStep(cur.theta, dt, ucSpeedRef.current)
      const next = { id: cur.id, theta: step.theta }
      ucPlayRef.current = next
      if (step.done) {
        stopUnitCirclePlay()
        return
      }
      setUcPlay(next)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    const onVisibility = (): void => {
      if (document.hidden) stopUnitCirclePlay()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [ucPlaying, stopUnitCirclePlay])

  /** What the board draws — θ is the animation's while it plays. */
  const ucFigures = useMemo<UnitCircleFigure[]>(
    () =>
      kind === 'cartesian'
        ? unitCircles.map((u) =>
            unitCircleFigure(u, { playTheta: ucPlay && ucPlay.id === u.id ? ucPlay.theta : null }),
          )
        : [],
    [kind, unitCircles, ucPlay],
  )
  const ucFiguresRef = useRef<UnitCircleFigure[]>(ucFigures)
  ucFiguresRef.current = ucFigures

  /** P(θ): the grab point, while the circle is selected or nothing else is. */
  const ucHandle = useMemo<ExtraHandle | null>(() => {
    if (kind !== 'cartesian' || ucPlay) return null
    const u = unitCircles.find((c) => c.hidden !== true && (selectedId === c.id || selectedId === null))
    if (!u) return null
    return {
      id: `uc:${u.id}:P`,
      pos: { x: u.cx + Math.cos(u.theta), y: u.cy + Math.sin(u.theta) },
      label: 'θ',
      color: u.color,
      onDrag: (p: Vec2) => {
        const live = ucRef.current.find((c) => c.id === u.id)
        if (!live) return
        const vp = vpRef.current
        const theta = dragTheta(live.theta, Math.atan2(p.y - live.cy, p.x - live.cx), ppuX(vp))
        const pre = preEditRef.current
        if (pre && pre.label === 'edit curve') preEditRef.current = { ...pre, label: 'move P' }
        if (selectedRef.current !== u.id) setSelectedId(u.id)
        if (theta === live.theta) return
        patchUnitCircle(u.id, { theta }, 'move P', true)
      },
    }
  }, [kind, ucPlay, unitCircles, selectedId, patchUnitCircle])

  const ucCards = useMemo(
    () =>
      unitCircles.map((u) => ({
        u,
        card: unitCircleCard(ucPlay && ucPlay.id === u.id ? { ...u, theta: ucPlay.theta } : u),
      })),
    [unitCircles, ucPlay],
  )

  const unitCircleCardNodes =
    kind === 'cartesian' && ucCards.length > 0
      ? ucCards.map(({ u, card }) => (
          <UnitCircleCard
            key={u.id}
            uc={u}
            card={card}
            selected={selectedId === u.id}
            playing={ucPlay !== null && ucPlay.id === u.id}
            speed={ucSpeed}
            onSelect={() => selectObject(u.id)}
            onDelete={() => deleteUnitCircle(u.id)}
            onToggleVisible={() =>
              patchUnitCircle(u.id, { hidden: u.hidden ? undefined : true }, u.hidden ? 'show unit circle' : 'hide unit circle')
            }
            onCycleColor={() => {
              const i = CURVE_COLORS.indexOf(u.color)
              patchUnitCircle(u.id, { color: CURVE_COLORS[(i + 1) % CURVE_COLORS.length] }, 'change colour')
            }}
            onZoom={() => zoomToUnitCircle(u.id)}
            onTheta={(t) => setUnitCircleTheta(u.id, t)}
            onDeg={(d) => patchUnitCircle(u.id, { deg: d ? true : undefined }, d ? 'degrees' : 'radians')}
            onShow={(patch: Partial<UnitCircleShow>) =>
              patchUnitCircle(u.id, { show: { ...u.show, ...patch } }, 'show / hide')
            }
            onUnwrap={(fn: UnwrapFn | null) =>
              patchUnitCircle(u.id, { unwrap: fn ?? undefined }, fn ? `unwrap ${fn}` : 'no unwrap')
            }
            onInverse={(inv) => setUnitCircleInverse(u.id, inv)}
            onPlay={(on) => playUnitCircle(u.id, on)}
            onSpeed={setUcSpeed}
          />
        ))
      : null

  return {
    addUnitCircle, deleteUnitCircle, ucFigures, ucFiguresRef, ucHandle, unitCircleCardNodes,
  }
}

export type UnitCircleApi = ReturnType<typeof useUnitCircle>

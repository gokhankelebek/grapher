// ============================================================================
// src/app/useRelatedRates.tsx — the related-rates problem: its givens, the animation and its card.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { solveWhen } from '../core/relatedRates'
import type { RRScenario } from '../core/relatedRates'
import { CURVE_COLORS, nextId } from '../core/types'
import type { RelatedRatesFigure } from '../render/relatedRates'
import { RelatedRatesCard } from '../ui/RelatedRatesCard'
import {
  newRelatedRates,
  relatedRatesBox,
  relatedRatesCard,
  relatedRatesFigure,
  rrPlayStart,
  rrPlayStep,
  switchScenario,
  tMaxOf,
} from '../ui/relatedRatesLinks'
import type { BoardRelatedRates } from '../ui/relatedRatesLinks'
import type { BoardStateApi } from './useBoardState'
import type { BoardRefsApi } from './useBoardRefs'
import type { NoticesApi } from './useNotices'
import type { HistoryApi } from './useHistory'
import type { CalcLinksApi } from './useCalcLinks'
import type { ViewportApi } from './useViewport'
import { playClock } from '../ui/motionPref'

/** What useRelatedRates reads from the hooks App calls before it. */
export interface RelatedRatesDeps {
  board: BoardStateApi
  refs: BoardRefsApi
  notices: NoticesApi
  history: HistoryApi
  calc: CalcLinksApi
  viewport: ViewportApi
}

export function useRelatedRates({ board, refs, notices, history, calc, viewport }: RelatedRatesDeps) {
  const {
    kind, selectedId, setSelectedId, relatedRates, rrPlay, setRrPlay, rrPlayRef, rrSpeed,
    setRrSpeed,
  } = board
  const { kindRef, rrRef } = refs
  const { showToast } = notices
  const { applyState, commitState, undo, editStart, editEnd } = history
  const { selectObject } = calc
  const { frameBox } = viewport

  // ========================================================== related rates
  //
  // One per board. The document holds the scenario, its givens, t, the
  // when-question and two switches (src/core/persist.ts BoardRelatedRates);
  // the picture, the formulas and every live value are re-derived from those
  // (src/ui/relatedRatesLinks.ts), so nothing drawn can go stale.

  /** One problem, replaced in place, with cleared optional keys REMOVED (not undefined). */
  const mapRR = useCallback(
    (id: string, patch: Partial<BoardRelatedRates>): BoardRelatedRates[] =>
      rrRef.current.map((r) => {
        if (r.id !== id) return r
        const next: BoardRelatedRates = { ...r, ...patch }
        for (const k of ['when', 'pause', 'graph', 'hidden'] as const) {
          if (k in patch && patch[k] === undefined) delete next[k]
        }
        return next
      }),
    [],
  )

  const patchRelatedRates = useCallback(
    (id: string, patch: Partial<BoardRelatedRates>, label: string, live = false): void => {
      if (!rrRef.current.some((r) => r.id === id)) return
      const next = mapRR(id, patch)
      if (live) applyState({ relatedRates: next })
      else commitState({ relatedRates: next }, label)
    },
    [applyState, commitState, mapRR],
  )

  const rrSpeedRef = useRef(rrSpeed)
  rrSpeedRef.current = rrSpeed

  /** Stop the animation, leaving t where it got to — one undo takes it back. */
  const stopRelatedRatesPlay = useCallback((): void => {
    const cur = rrPlayRef.current
    if (!cur) return
    rrPlayRef.current = null
    setRrPlay(null)
    const r = rrRef.current[0]
    if (r) patchRelatedRates(r.id, { t: cur.t }, 'play t')
  }, [patchRelatedRates])

  /** Build ▾ → Related rates: put it on the board, or select the one already there. */
  const addRelatedRates = useCallback((): void => {
    if (kindRef.current !== 'cartesian') return
    const have = rrRef.current[0]
    if (have) {
      setSelectedId(have.id)
      showToast('This board already has its related-rates problem — it is selected.', { ms: 2600 })
      return
    }
    const rr = newRelatedRates(nextId())
    commitState({ relatedRates: [...rrRef.current, rr] }, 'add related rates')
    setSelectedId(rr.id)
    frameBox(relatedRatesBox(rr))
  }, [commitState, frameBox, showToast])

  const deleteRelatedRates = useCallback(
    (id: string): void => {
      if (!rrRef.current.some((r) => r.id === id)) return
      rrPlayRef.current = null
      setRrPlay(null)
      commitState({ relatedRates: rrRef.current.filter((r) => r.id !== id) }, 'delete related rates')
      showToast('Deleted the related-rates problem. Undo brings it back.', {
        action: { label: 'Undo', run: () => undo() },
      })
      setSelectedId((sel) => (sel === id ? null : sel))
    },
    [commitState, showToast, undo],
  )

  /** A change of givens: t stays where it was when that is still in range, else the question is re-asked. */
  const setRelatedRatesParams = useCallback(
    (id: string, patch: Record<string, number>): void => {
      const r = rrRef.current.find((c) => c.id === id)
      if (!r) return
      rrPlayRef.current = null
      setRrPlay(null)
      const params = { ...r.params, ...patch }
      const probe: BoardRelatedRates = { ...r, params }
      let t = Math.min(r.t, tMaxOf(probe))
      if (r.when) {
        const w = solveWhen(r.scenario, params, r.when.q, r.when.v)
        if (w.ok) t = w.t
      }
      patchRelatedRates(id, { params, t }, 'change givens')
    },
    [patchRelatedRates],
  )

  const setRelatedRatesWhen = useCallback(
    (id: string, when: { q: string; v: number } | null): void => {
      const r = rrRef.current.find((c) => c.id === id)
      if (!r) return
      rrPlayRef.current = null
      setRrPlay(null)
      if (!when) {
        patchRelatedRates(id, { when: undefined, pause: undefined }, 'clear question')
        return
      }
      const w = solveWhen(r.scenario, r.params, when.q, when.v)
      patchRelatedRates(id, w.ok ? { when, t: w.t } : { when }, `when ${when.q} = ${when.v}`)
    },
    [patchRelatedRates],
  )

  const playRelatedRates = useCallback(
    (id: string, on: boolean): void => {
      const r = rrRef.current.find((c) => c.id === id)
      if (!r) return
      if (!on) {
        stopRelatedRatesPlay()
        return
      }
      const T = tMaxOf(r)
      const w = r.when ? solveWhen(r.scenario, r.params, r.when.q, r.when.v) : null
      const stopAt = r.pause && w && w.ok ? w.t : null
      // "Pause at that instant": Play runs up to it — from 0 when t is already there or past it.
      const start = stopAt !== null && r.t >= stopAt - 1e-9 ? 0 : rrPlayStart(r.t, T)
      const next = { t: start }
      rrPlayRef.current = next
      setRrPlay(next)
    },
    [stopRelatedRatesPlay],
  )

  const rrPlaying = rrPlay !== null
  useEffect(() => {
    if (!rrPlaying) return
    let raf = 0
    // Reduced motion: Play advances in half-second steps instead of gliding.
    const clock = playClock(performance.now())
    const tick = (now: number): void => {
      const dt = clock(now)
      if (dt === null) {
        raf = requestAnimationFrame(tick)
        return
      }
      const cur = rrPlayRef.current
      if (!cur) return
      const r = rrRef.current[0]
      if (!r) {
        // The problem is gone (an undo took it off the board): clear the play
        // state, or the card comes back stuck on ■ with nothing moving.
        rrPlayRef.current = null
        setRrPlay(null)
        return
      }
      const w = r.pause && r.when ? solveWhen(r.scenario, r.params, r.when.q, r.when.v) : null
      const step = rrPlayStep(cur.t, dt, rrSpeedRef.current, tMaxOf(r), w && w.ok ? w.t : null)
      const next = { t: step.t }
      rrPlayRef.current = next
      if (step.done) {
        stopRelatedRatesPlay()
        return
      }
      setRrPlay(next)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    const onVisibility = (): void => {
      if (document.hidden) stopRelatedRatesPlay()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [rrPlaying, stopRelatedRatesPlay])

  /** What the board draws — t is the animation's while it plays. */
  const rrFigures = useMemo<RelatedRatesFigure[]>(
    () =>
      kind === 'cartesian'
        ? relatedRates.map((r) => relatedRatesFigure(r, { playT: rrPlay ? rrPlay.t : null }))
        : [],
    [kind, relatedRates, rrPlay],
  )
  const rrFiguresRef = useRef<RelatedRatesFigure[]>(rrFigures)
  rrFiguresRef.current = rrFigures

  const relatedRatesCardNodes =
    kind === 'cartesian' && relatedRates.length > 0
      ? relatedRates.map((r) => (
          <RelatedRatesCard
            key={r.id}
            rr={r}
            card={relatedRatesCard(r, rrPlay ? rrPlay.t : null)}
            selected={selectedId === r.id}
            playing={rrPlay !== null}
            speed={rrSpeed}
            onSelect={() => selectObject(r.id)}
            onDelete={() => deleteRelatedRates(r.id)}
            onToggleVisible={() =>
              patchRelatedRates(r.id, { hidden: r.hidden ? undefined : true }, r.hidden ? 'show related rates' : 'hide related rates')
            }
            onCycleColor={() => {
              const i = CURVE_COLORS.indexOf(r.color)
              patchRelatedRates(r.id, { color: CURVE_COLORS[(i + 1) % CURVE_COLORS.length] }, 'change colour')
            }}
            onZoom={() => frameBox(relatedRatesBox(r))}
            onScenario={(sc: RRScenario) => {
              rrPlayRef.current = null
              setRrPlay(null)
              const next = switchScenario(r, sc)
              commitState({ relatedRates: rrRef.current.map((c) => (c.id === r.id ? next : c)) }, `related rates: ${sc}`)
              frameBox(relatedRatesBox(next))
            }}
            onParams={(patch) => setRelatedRatesParams(r.id, patch)}
            onT={(t, live) => {
              rrPlayRef.current = null
              setRrPlay(null)
              if (live) {
                // One undo for the whole slider drag: the bracket opens once.
                editStart('move t')
                patchRelatedRates(r.id, { t }, 'move t', true)
              } else patchRelatedRates(r.id, { t }, 'set t')
            }}
            onTEnd={editEnd}
            onWhen={(w) => setRelatedRatesWhen(r.id, w)}
            onPause={(on) => patchRelatedRates(r.id, { pause: on ? true : undefined }, on ? 'pause at instant' : 'no pause')}
            onGraph={(on) => patchRelatedRates(r.id, { graph: on ? undefined : false }, on ? 'show rate graph' : 'hide rate graph')}
            onPlay={(on) => playRelatedRates(r.id, on)}
            onSpeed={setRrSpeed}
          />
        ))
      : null

  return {
    addRelatedRates, deleteRelatedRates, rrFigures, rrFiguresRef, relatedRatesCardNodes,
  }
}

export type RelatedRatesApi = ReturnType<typeof useRelatedRates>

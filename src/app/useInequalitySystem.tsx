// ============================================================================
// src/app/useInequalitySystem.tsx — the inequality system: region, test point, objective and its card.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useCallback, useMemo, useRef } from 'react'
import { parseObjective } from '../core/linprog'
import type { BoardIneqSystem } from '../core/persist'
import { ppuX, ppuY } from '../core/types'
import type { Vec2 } from '../core/types'
import type { ExtraHandle } from '../ui/CanvasStage'
import type { Overlay } from '../ui/renderBoard'
import { snapPlaced } from '../ui/snap'
import { inequalityCount, systemCard, systemOverlays, TEST_COLOR } from '../ui/systemLinks'
import type { BoardStateApi } from './useBoardState'
import type { BoardRefsApi } from './useBoardRefs'
import type { ModelsApi } from './useModels'
import type { HistoryApi } from './useHistory'
import { lazyComponent, lazyModule } from '../ui/lazyLoad'

// The card loads when the first one shows, or in the idle prefetch after the
// first paint (src/ui/lazyLoad.tsx); what the board draws stays in the main chunk.
const SystemCard = lazyComponent(lazyModule(() => import('../ui/SystemCard')), (m) => m.SystemCard)

/** What useInequalitySystem reads from the hooks App calls before it. */
export interface InequalitySystemDeps {
  board: BoardStateApi
  refs: BoardRefsApi
  derived: ModelsApi
  history: HistoryApi
}

export function useInequalitySystem({ board, refs, derived, history }: InequalitySystemDeps) {
  const { curves, kind, ineqSystem } = board
  const { preEditRef, sysRef } = refs
  const { models, depKeys, vpRef } = derived
  const { applyState, commitState } = history

  // ================================================= inequality system
  //
  // Two-variable inequalities are typed curves; their SYSTEM is every
  // visible one on the board. The document keeps only what was set for it
  // (src/core/persist.ts BoardIneqSystem); the common region, the corners,
  // the objective's table and the test point's verdicts are recomputed from
  // the curves on every change (src/ui/systemLinks.ts).

  /** One stated change to the system. `live` is a drag in flight (one undo per drag). */
  const patchSystem = useCallback(
    (patch: Partial<BoardIneqSystem>, label: string, live = false): void => {
      const next: BoardIneqSystem = { ...(sysRef.current ?? {}), ...patch }
      for (const k of ['solution', 'test', 'objective', 'iso'] as const) {
        if (k in patch && patch[k] === undefined) delete next[k]
      }
      const stored = Object.keys(next).length > 0 ? next : null
      if (live) applyState({ system: stored })
      else commitState({ system: stored }, label)
    },
    [applyState, commitState],
  )

  const sysCard = useMemo(
    () => (kind === 'cartesian' ? systemCard(curves, models, ineqSystem) : null),
    // depKeys: a line that calls f shades anew when f moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, curves, models, ineqSystem, depKeys],
  )
  const sysOverlays = useMemo<Overlay[]>(() => systemOverlays(sysCard, ineqSystem), [sysCard, ineqSystem])
  /** The solution region is drawn only while there is a system to intersect. */
  const ineqSolution = ineqSystem?.solution === true && (sysCard?.members.length ?? 0) >= 2
  const ineqSolutionRef = useRef(ineqSolution)
  ineqSolutionRef.current = ineqSolution

  /** The test point: dragged anywhere, snapped to the grid's ladder. */
  const sysTestHandle = useMemo<ExtraHandle | null>(() => {
    const t = ineqSystem?.test
    if (kind !== 'cartesian' || !t || !sysCard) return null
    return {
      id: 'ineq:test',
      pos: t,
      label: 'test point',
      color: TEST_COLOR,
      onDrag: (p: Vec2) => {
        const q = snapPlaced(p, vpRef.current)
        const now = sysRef.current?.test
        const pre = preEditRef.current
        if (pre && pre.label === 'edit curve') preEditRef.current = { ...pre, label: 'move test point' }
        if (now && now.x === q.x && now.y === q.y) return
        patchSystem({ test: q }, 'move test point', true)
      },
    }
  }, [kind, ineqSystem, sysCard, patchSystem])

  const systemCardNode =
    kind === 'cartesian' && sysCard ? (
      <SystemCard
        data={sysCard}
        system={ineqSystem}
        hidden={inequalityCount(curves, models) - sysCard.members.length}
        onSolution={(on) => patchSystem({ solution: on ? true : undefined }, on ? 'show solution region' : 'hide solution region')}
        onTest={(on) => {
          if (!on) {
            patchSystem({ test: undefined }, 'remove test point')
            return
          }
          // The origin when it is on the board, else the middle of the view.
          const vp = vpRef.current
          const half = { x: vp.widthPx / 2 / ppuX(vp), y: vp.heightPx / 2 / ppuY(vp) }
          const originOn = Math.abs(vp.center.x) < half.x * 0.8 && Math.abs(vp.center.y) < half.y * 0.8
          const at = originOn ? { x: 1, y: 2 } : snapPlaced(vp.center, vp)
          patchSystem({ test: at }, 'test point')
        }}
        onObjective={(src, goal) => {
          if (src.trim() === '') {
            patchSystem({ objective: undefined, iso: undefined }, 'remove objective')
            return null
          }
          const o = parseObjective(src)
          if (!o.ok) return o.error
          patchSystem({ objective: { src: src.trim(), goal } }, goal === 'max' ? 'maximise' : 'minimise')
          return null
        }}
        onIso={(on) => patchSystem({ iso: on ? true : undefined }, on ? 'iso-profit line' : 'no iso-profit line')}
      />
    ) : null

  return {
    sysCard, sysOverlays, ineqSolution, ineqSolutionRef, sysTestHandle, systemCardNode,
  }
}

export type InequalitySystemApi = ReturnType<typeof useInequalitySystem>

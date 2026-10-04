// ============================================================================
// src/app/useStats.tsx — the statistics objects: normal distributions and
// simulations, their drag handles, the simulation's build-up and their cards.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CURVE_COLORS, nextId } from '../core/types'
import type { Vec2 } from '../core/types'
import { freshSeed, normalCdf, normalPdf } from '../core/stats'
import { MAX_STATS } from '../core/statsPersist'
import type { StatsFigure } from '../render/stats'
import type { ExtraHandle } from '../ui/CanvasStage'
import { probCard, probSpots, settleProb, toggleLeaf } from '../ui/probLinks'
import type { BoardProb } from '../ui/probLinks'
import { newProb } from '../core/probPersist'
import type { TableColumn } from '../ui/DataPlotCard'
import { dataPlotCard, dataPlotSpots, newDataPlot, toggleOff } from '../ui/dataPlotLinks'
import type { BoardDataPlot } from '../ui/dataPlotLinks'
import { residualFigures } from '../ui/residualLinks'
import { dataColumns } from '../ui/dataLinks'
import {
  newNormal,
  newSim,
  normalCard,
  normalFrame,
  normalGeometry,
  percentileX,
  simCard,
  simPlayStep,
  simResult,
  snapTo,
  statName,
  statsBox,
  statsFigures,
} from '../ui/statsLinks'
import type { BoardNormal, BoardSim, BoardStat, Frame } from '../ui/statsLinks'
import { niceStep } from '../core/stats'
import type { BoardStateApi } from './useBoardState'
import type { BoardRefsApi } from './useBoardRefs'
import type { NoticesApi } from './useNotices'
import type { HistoryApi } from './useHistory'
import type { CalcLinksApi } from './useCalcLinks'
import type { ViewportApi } from './useViewport'
import { playClock } from '../ui/motionPref'
import { lazyComponent, lazyModule } from '../ui/lazyLoad'

// The card loads when the first one shows, or in the idle prefetch after the
// first paint (src/ui/lazyLoad.tsx); what the board draws stays in the main chunk.
const statsCards = lazyModule(() => import('../ui/StatsCard'))
const NormalCard = lazyComponent(statsCards, (m) => m.NormalCard)
const SimCard = lazyComponent(statsCards, (m) => m.SimCard)
const DataPlotCard = lazyComponent(lazyModule(() => import('../ui/DataPlotCard')), (m) => m.DataPlotCard)
const ProbCard = lazyComponent(lazyModule(() => import('../ui/ProbCard')), (m) => m.ProbCard)

/** What useStats reads from the hooks App calls before it. */
export interface StatsDeps {
  board: BoardStateApi
  refs: BoardRefsApi
  notices: NoticesApi
  history: HistoryApi
  calc: CalcLinksApi
  viewport: ViewportApi
}

/** The optional keys a patch clears by passing undefined: removed, never stored as undefined. */
const OPTIONAL = ['rule', 'zRow', 'hidden', 'theory', 'observed', 'binWidth', 'dropOutliers'] as const

export function useStats({ board, refs, notices, history, calc, viewport }: StatsDeps) {
  const { kind, selectedId, setSelectedId, stats, statsPlay, setStatsPlay, statsPlayRef, dataSets, curves } = board
  const { kindRef, selectedRef, preEditRef, statsRef, fitCacheRef } = refs
  const { showToast } = notices
  const { applyState, commitState, undo } = history
  const { selectObject } = calc
  const { frameBox } = viewport

  // ============================================================= statistics
  //
  // The document holds what the teacher SET (src/core/statsPersist.ts); every
  // probability, z-score and simulated statistic is re-derived from it
  // (src/ui/statsLinks.ts). A simulation is a pure function of its settings
  // and its seed, so the same document always shows the same samples.

  const mapStat = useCallback(
    (id: string, patch: Partial<BoardNormal> | Partial<BoardSim> | Partial<BoardDataPlot> | Partial<BoardProb>): BoardStat[] =>
      statsRef.current.map((s) => {
        if (s.id !== id) return s
        const next = { ...s, ...patch } as BoardStat
        const rec = next as unknown as Record<string, unknown>
        for (const k of OPTIONAL) if (k in patch && (patch as Record<string, unknown>)[k] === undefined) delete rec[k]
        return next
      }),
    [],
  )

  /** One stated change. `live`: a drag in flight, inside the bracket the gesture opened (one undo). */
  const patchStat = useCallback(
    (id: string, patch: Partial<BoardNormal> | Partial<BoardSim> | Partial<BoardDataPlot> | Partial<BoardProb>, label: string, live = false): void => {
      if (!statsRef.current.some((s) => s.id === id)) return
      const next = mapStat(id, patch)
      if (live) applyState({ stats: next })
      else commitState({ stats: next }, label)
    },
    [applyState, commitState, mapStat],
  )

  const stopPlay = useCallback((): void => {
    if (!statsPlayRef.current) return
    statsPlayRef.current = null
    setStatsPlay(null)
  }, [])

  const add = useCallback(
    (make: (id: string) => BoardStat, label: string): void => {
      if (kindRef.current !== 'cartesian') return
      if (statsRef.current.length >= MAX_STATS) {
        showToast(`A board holds up to ${MAX_STATS} statistics objects.`, { ms: 2600 })
        return
      }
      const s = make(nextId())
      const index = statsRef.current.length
      commitState({ stats: [...statsRef.current, s] }, label)
      setSelectedId(s.id)
      frameBox(statsBox(index))
    },
    [commitState, frameBox, showToast],
  )

  /** Build ▾ → Normal distribution. */
  const addNormal = useCallback((): void => add((id) => newNormal(id), 'add normal distribution'), [add])
  /** Build ▾ → Simulation. */
  const addSimulation = useCallback((): void => add((id) => newSim(id, freshSeed()), 'add simulation'), [add])
  /** Build ▾ → One-variable data. */
  const addDataPlot = useCallback((): void => add((id) => newDataPlot(id), 'add data plot'), [add])
  /** Build ▾ → Probability (two-way table, Venn diagram, tree diagram). */
  const addProbability = useCallback((): void => add((id) => newProb(id), 'add probability'), [add])

  const deleteStat = useCallback(
    (id: string): void => {
      const s = statsRef.current.find((c) => c.id === id)
      if (!s) return
      if (statsPlayRef.current?.id === id) stopPlay()
      commitState({ stats: statsRef.current.filter((c) => c.id !== id) }, `delete ${statName(s).toLowerCase()}`)
      showToast(`Deleted the ${statName(s).toLowerCase()}. Undo brings it back.`, {
        action: { label: 'Undo', run: () => undo() },
      })
      setSelectedId((sel) => (sel === id ? null : sel))
    },
    [commitState, showToast, undo, stopPlay],
  )

  const zoomTo = useCallback(
    (id: string): void => {
      const i = statsRef.current.findIndex((c) => c.id === id)
      if (i >= 0) frameBox(statsBox(i))
    },
    [frameBox],
  )

  // ---- Play: a simulation's plot builds up, sample by sample
  const playSim = useCallback(
    (id: string, on: boolean): void => {
      if (!on) {
        stopPlay()
        return
      }
      const s = statsRef.current.find((c) => c.id === id)
      if (!s || s.type !== 'sim') return
      const next = { id, shown: 0 }
      statsPlayRef.current = next
      setStatsPlay(next)
    },
    [stopPlay],
  )
  const playing = statsPlay !== null
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const clock = playClock(performance.now())
    const tick = (now: number): void => {
      const dt = clock(now)
      if (dt === null) {
        raf = requestAnimationFrame(tick)
        return
      }
      const cur = statsPlayRef.current
      if (!cur) return
      const s = statsRef.current.find((c) => c.id === cur.id)
      const r = s && s.type === 'sim' ? simResult(s) : null
      const total = r ? (r.mode === 'sample' ? r.values.length : r.diffs.length) : 0
      if (!s || total === 0) {
        stopPlay()
        return
      }
      const step = simPlayStep(cur.shown, dt, 1, total)
      if (step.done) {
        stopPlay()
        return
      }
      const next = { id: cur.id, shown: step.shown }
      statsPlayRef.current = next
      setStatsPlay(next)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    const onVisibility = (): void => {
      if (document.hidden) stopPlay()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [playing, stopPlay])

  // ---- a drag holds the frame still, so the curve moves under the pointer
  const [dragFrame, setDragFrame] = useState<{ id: string; frame: Frame } | null>(null)
  const dragFrameRef = useRef(dragFrame)
  dragFrameRef.current = dragFrame
  useEffect(() => {
    if (!dragFrame) return
    const release = (): void => setDragFrame(null)
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    return () => {
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
    }
  }, [dragFrame !== null])

  /** A data table's residual plot (under its scatter plot) is a statistics panel too. */
  const residFigs = useMemo<StatsFigure[]>(() => {
    if (kind !== 'cartesian' || !dataSets.some((d) => d.regressions.some((r) => r.residualPlot))) return []
    return residualFigures(dataSets, new Set(curves.map((c) => c.id)), fitCacheRef.current)
  }, [kind, dataSets, curves])

  /** What the board draws: the build-up while one plays, the held frame while one is dragged. */
  const statsFigs = useMemo<StatsFigure[]>(
    () =>
      kind === 'cartesian'
        ? [
            ...statsFigures(stats, (s) => ({
              frame: dragFrame && dragFrame.id === s.id ? dragFrame.frame : null,
              shown: statsPlay && statsPlay.id === s.id ? statsPlay.shown : null,
            })),
            ...residFigs,
          ]
        : [],
    [kind, stats, statsPlay, dragFrame, residFigs],
  )
  const statsFiguresRef = useRef<StatsFigure[]>(statsFigs)
  statsFiguresRef.current = statsFigs

  /**
   * A normal curve's grab points, while it is selected or nothing is: the peak
   * (μ), the right shoulder at μ + σ (σ), and the bounds on the axis (a, b,
   * or the percentile's x). Each snaps to a step that suits σ.
   */
  const statsHandles = useMemo<ExtraHandle[]>(() => {
    if (kind !== 'cartesian') return []
    const out: ExtraHandle[] = []
    stats.forEach((s, index) => {
      // A probability panel, while its card is selected: a table cell makes its row A and its
      // column B; a tree leaf goes in or out of the event.
      if (s.type === 'prob') {
        if (s.hidden === true || selectedId !== s.id) return
        for (const spot of probSpots(s, index)) {
          out.push({
            id: spot.kind === 'cell' ? `stat:${s.id}:cell:${spot.row}:${spot.col}` : `stat:${s.id}:leaf:${spot.key}`,
            pos: spot.pos,
            label: spot.kind === 'cell' ? `${s.table.rows[spot.row]} and ${s.table.cols[spot.col]}` : spot.label,
            color: s.color,
            glyph: 'none',
            onDrag: () => {},
            onTap: () => {
              const cur = statsRef.current.find((c) => c.id === s.id)
              if (!cur || cur.type !== 'prob') return
              let next: BoardProb
              let label: string
              if (spot.kind === 'cell') {
                if (cur.table.a === spot.row && cur.table.b === spot.col) return
                next = { ...cur, table: { ...cur.table, a: spot.row, b: spot.col } }
                label = 'pick A and B'
              } else {
                next = toggleLeaf(cur, spot.key)
                label = cur.tree.pick.includes(spot.key) ? `leave out ${spot.label}` : `include ${spot.label}`
              }
              commitState({ stats: statsRef.current.map((c) => (c.id === s.id ? next : c)) }, label)
            },
          })
        }
        return
      }
      // A data plot's dots, while its card is selected: a click leaves a value out, or brings it back.
      if (s.type === 'data') {
        if (s.hidden === true || selectedId !== s.id) return
        for (const spot of dataPlotSpots(s, index)) {
          out.push({
            id: `stat:${s.id}:dot:${spot.set}:${spot.i}`,
            pos: spot.pos,
            label: String(spot.value),
            color: s.color,
            glyph: 'none',
            onDrag: () => {},
            onTap: () => {
              const cur = statsRef.current.find((c) => c.id === s.id)
              if (!cur || cur.type !== 'data') return
              const set = cur.sets[spot.set]
              const wasOff = (set?.off ?? []).includes(spot.i)
              commitState({ stats: statsRef.current.map((c) => (c.id === s.id ? toggleOff(cur, spot.set, spot.i) : c)) }, wasOff ? `bring back ${spot.value}` : `leave out ${spot.value}`)
            },
          })
        }
        return
      }
      if (s.type !== 'normal' || s.hidden === true) return
      if (selectedId !== s.id && selectedId !== null) return
      const held = dragFrame && dragFrame.id === s.id ? dragFrame.frame : null
      const g = normalGeometry(s, index, held)
      const hold = (): Frame => {
        const cur = dragFrameRef.current
        if (cur && cur.id === s.id) return cur.frame
        const f = held ?? normalFrame(s)
        const v = { id: s.id, frame: f }
        dragFrameRef.current = v
        setDragFrame(v)
        return f
      }
      const live = (): BoardNormal | null => {
        const c = statsRef.current.find((x) => x.id === s.id)
        return c && c.type === 'normal' ? c : null
      }
      const begin = (label: string): void => {
        const pre = preEditRef.current
        if (pre && pre.label === 'edit curve') preEditRef.current = { ...pre, label }
        if (selectedRef.current !== s.id) setSelectedId(s.id)
      }
      const geo = (frame: Frame) => normalGeometry(live() ?? s, index, frame)
      const step = (sigma: number): number => niceStep(sigma / 20)
      const peak = normalPdf(s.mu, s.mu, s.sigma)
      out.push({
        id: `stat:${s.id}:mu`,
        pos: { x: g.toX(s.mu), y: g.toY(peak) },
        label: 'μ',
        color: s.color,
        onDrag: (p: Vec2) => {
          const cur = live()
          if (!cur) return
          begin('move μ')
          const v = snapTo(geo(hold()).fromX(p.x), step(cur.sigma))
          if (v !== cur.mu) patchStat(s.id, { mu: v }, 'move μ', true)
        },
      })
      out.push({
        id: `stat:${s.id}:sigma`,
        pos: { x: g.toX(s.mu + s.sigma), y: g.toY(normalPdf(s.mu + s.sigma, s.mu, s.sigma)) },
        label: 'σ',
        color: s.color,
        onDrag: (p: Vec2) => {
          const cur = live()
          if (!cur) return
          begin('change σ')
          const raw = Math.abs(geo(hold()).fromX(p.x) - cur.mu)
          const st = niceStep(cur.sigma / 20)
          const v = Math.max(st, snapTo(raw, st))
          if (v !== cur.sigma) patchStat(s.id, { sigma: v }, 'change σ', true)
        },
      })
      const axis = g.toY(0)
      if (s.mode === 'percentile') {
        out.push({
          id: `stat:${s.id}:pct`,
          pos: { x: g.toX(percentileX(s)), y: axis },
          label: 'percentile',
          color: s.color,
          onDrag: (p: Vec2) => {
            const cur = live()
            if (!cur) return
            begin('move percentile')
            const x = geo(hold()).fromX(p.x)
            const pct = Math.min(99.9, Math.max(0.1, Math.round(normalCdf(x, cur.mu, cur.sigma) * 1000) / 10))
            if (pct !== cur.pct) patchStat(s.id, { pct }, 'move percentile', true)
          },
        })
      } else {
        const keys: ('a' | 'b')[] = s.mode === 'between' || s.mode === 'outside' ? ['a', 'b'] : ['a']
        for (const k of keys) {
          out.push({
            id: `stat:${s.id}:${k}`,
            pos: { x: g.toX(s[k]), y: axis },
            label: k,
            color: s.color,
            onDrag: (p: Vec2) => {
              const cur = live()
              if (!cur) return
              begin(`move ${k}`)
              const v = snapTo(geo(hold()).fromX(p.x), step(cur.sigma))
              if (v !== cur[k]) patchStat(s.id, { [k]: v } as Partial<BoardNormal>, `move ${k}`, true)
            },
          })
        }
      }
    })
    return out
  }, [kind, stats, selectedId, dragFrame, patchStat, commitState])

  /** Every numeric column of the board's data tables, for "From a table…" on a data plot's card. */
  const tableColumns = useMemo<TableColumn[]>(() => {
    const out: TableColumn[] = []
    for (const d of dataSets) {
      const cols = dataColumns(d.rows)
      if (cols.xs.length === 0) continue
      out.push({ key: `${d.id}:x`, label: `${d.name} · ${d.xLabel || 'x'}`, values: cols.xs })
      out.push({ key: `${d.id}:y`, label: `${d.name} · ${d.yLabel || 'y'}`, values: cols.ys })
    }
    return out
  }, [dataSets])

  const statsCardNodes =
    kind === 'cartesian' && stats.length > 0
      ? stats.map((s) => {
          const common = {
            selected: selectedId === s.id,
            onSelect: () => selectObject(s.id),
            onDelete: () => deleteStat(s.id),
            onToggleVisible: () =>
              patchStat(s.id, { hidden: s.hidden ? undefined : true }, s.hidden ? `show ${statName(s).toLowerCase()}` : `hide ${statName(s).toLowerCase()}`),
            onCycleColor: () => {
              const i = CURVE_COLORS.indexOf(s.color)
              patchStat(s.id, { color: CURVE_COLORS[(i + 1) % CURVE_COLORS.length] }, 'change color')
            },
            onZoom: () => zoomTo(s.id),
          }
          if (s.type === 'prob') {
            return (
              <ProbCard
                key={s.id}
                p={s}
                card={probCard(s)}
                {...common}
                onPatch={(patch, label) => {
                  const cur = statsRef.current.find((c) => c.id === s.id)
                  if (!cur || cur.type !== 'prob') return
                  const next = settleProb({ ...cur, ...patch })
                  patchStat(s.id, { view: next.view, table: next.table, venn: next.venn, tree: next.tree }, label)
                }}
              />
            )
          }
          if (s.type === 'data') {
            return (
              <DataPlotCard
                key={s.id}
                p={s}
                card={dataPlotCard(s)}
                columns={tableColumns}
                {...common}
                onPatch={(patch, label) => patchStat(s.id, patch, label)}
              />
            )
          }
          if (s.type === 'normal') {
            return (
              <NormalCard
                key={s.id}
                n={s}
                card={normalCard(s)}
                {...common}
                onPatch={(patch, label) => patchStat(s.id, patch, label)}
              />
            )
          }
          return (
            <SimCard
              key={s.id}
              s={s}
              card={simCard(s)}
              playing={statsPlay !== null && statsPlay.id === s.id}
              {...common}
              onPatch={(patch, label) => {
                if (statsPlayRef.current?.id === s.id) stopPlay()
                patchStat(s.id, patch, label)
              }}
              onPlay={(on) => playSim(s.id, on)}
              onReseed={() => {
                if (statsPlayRef.current?.id === s.id) stopPlay()
                patchStat(s.id, { seed: freshSeed() }, 'new samples')
              }}
            />
          )
        })
      : null

  return {
    addNormal, addSimulation, addDataPlot, addProbability, deleteStat, statsFigs, statsFiguresRef, statsHandles, statsCardNodes,
  }
}

export type StatsApi = ReturnType<typeof useStats>

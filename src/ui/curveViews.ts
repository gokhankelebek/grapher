// ============================================================================
// src/ui/curveViews.ts — the per-curve view settings, between the App's four
// session maps and the document's one map (src/core/persist.ts CurveView).
//
// The App keeps each setting where the section that owns it reads it:
//
//     construction   curveId -> the conic's "show construction"
//     showParent     curveId -> the transformation's "show parent"
//     factorThrough  curveId -> the point a factored curve is built through
//     motion         curveId -> the Motion player (t, playing, speed, accel,
//                               exportParticle, a polar curve's area)
//     lens           curveId -> the Domain section's board switches: the
//                               cut-off part's ghost, the horizontal line
//                               test's height, the reflected point's a
//     table          curveId -> the Table section's settings (what was typed:
//                               start, step, rows, columns, Evaluate, compare,
//                               divide, "on the figure")
//
// and the document stores them as one CurveViews map. This file is the whole
// translation, both ways, plus the two history rules:
//
//   * a curve that LEAVES the board takes its settings with it (prune), and
//   * a curve that ARRIVES back through undo / redo brings the settings its
//     snapshot recorded (restore). A curve that was there all along keeps the
//     settings it has now: switching a construction on is not an undo step,
//     so undoing an unrelated edit must not switch it back off.
//
// The particle's t, play / pause and speed are not document state (see
// CurveView) and are never written; a restored curve's player starts at the
// beginning of its interval, paused, at normal speed.
//
// Pure: no React, no DOM.
// ============================================================================

import type { FittedCurve, Vec2 } from '../core/types'
import type { CurveView, CurveViews, ValueTableView } from '../core/persist'
import { normalizeCurveView, normalizeTableView } from '../core/persist'
import type { MotionPlayState } from './motionLinks'
import { defaultPlay, motionInterval } from './motionLinks'

/** The Domain section's board switches for one curve (every field absent at its default). */
export interface DomainLens {
  ghost?: true
  hlt?: number
  reflect?: number
}

export interface ViewStates {
  construction: Record<string, boolean>
  showParent: Record<string, boolean>
  factorThrough: Record<string, Vec2>
  motion: Record<string, MotionPlayState>
  lens: Record<string, DomainLens>
  table: Record<string, ValueTableView>
}

export const emptyViewStates = (): ViewStates => ({
  construction: {},
  showParent: {},
  factorThrough: {},
  motion: {},
  lens: {},
  table: {},
})

/** Same settings, field for field (the order a normaliser writes them in). */
function sameTable(a: ValueTableView | undefined, b: ValueTableView | null): boolean {
  if (!a || !b) return !a && !b
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * One curve's Table settings, patched: a field set to `undefined` (or a
 * default) is dropped. The same map when nothing changed, so a re-typed
 * identical value schedules no save.
 */
export function patchTableView(
  m: Record<string, ValueTableView>,
  id: string,
  patch: Partial<Record<keyof ValueTableView, unknown>>,
): Record<string, ValueTableView> {
  const cur = m[id]
  const next: Record<string, unknown> = { ...(cur ?? {}) }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null) delete next[k]
    else next[k] = v
  }
  const norm = normalizeTableView(next)
  if (sameTable(cur, norm)) return m
  const out = { ...m }
  if (norm) out[id] = norm
  else delete out[id]
  return out
}

/** A lens with its defaults dropped, or null when nothing is left. */
export function normalizeLens(l: DomainLens | undefined | null): DomainLens | null {
  if (!l) return null
  const out: DomainLens = {}
  if (l.ghost === true) out.ghost = true
  if (typeof l.hlt === 'number' && Number.isFinite(l.hlt)) out.hlt = l.hlt
  if (typeof l.reflect === 'number' && Number.isFinite(l.reflect)) out.reflect = l.reflect
  return Object.keys(out).length > 0 ? out : null
}

/** One curve's lens, patched: `undefined` in the patch clears that field. The same map when nothing changed. */
export function patchLens(
  m: Record<string, DomainLens>,
  id: string,
  patch: { ghost?: boolean; hlt?: number | null; reflect?: number | null },
): Record<string, DomainLens> {
  const cur = m[id] ?? {}
  const next: DomainLens = { ...cur }
  if ('ghost' in patch) {
    if (patch.ghost) next.ghost = true
    else delete next.ghost
  }
  if ('hlt' in patch) {
    if (typeof patch.hlt === 'number' && Number.isFinite(patch.hlt)) next.hlt = patch.hlt
    else delete next.hlt
  }
  if ('reflect' in patch) {
    if (typeof patch.reflect === 'number' && Number.isFinite(patch.reflect)) next.reflect = patch.reflect
    else delete next.reflect
  }
  const norm = normalizeLens(next)
  if (
    (norm === null && !(id in m)) ||
    (norm !== null && cur.ghost === norm.ghost && cur.hlt === norm.hlt && cur.reflect === norm.reflect && id in m)
  ) {
    return m
  }
  const out = { ...m }
  if (norm) out[id] = norm
  else delete out[id]
  return out
}

/** One curve's settings out of the maps, defaults dropped (null = none). */
export function curveViewOf(s: ViewStates, id: string): CurveView | null {
  const v: CurveView = {}
  if (s.construction[id] === true) v.construction = true
  if (typeof s.showParent[id] === 'boolean') v.showParent = s.showParent[id]
  const m = s.motion[id]
  if (m) {
    if (m.area) v.area = { on: m.area.on, a: m.area.a, b: m.area.b }
    if (m.accel) v.accel = true
    if (m.exportParticle) v.exportParticle = true
  }
  const p = s.factorThrough[id]
  if (p) v.through = { x: p.x, y: p.y }
  const l = normalizeLens(s.lens[id])
  if (l) {
    if (l.ghost) v.ghost = true
    if (l.hlt !== undefined) v.hlt = l.hlt
    if (l.reflect !== undefined) v.reflect = l.reflect
  }
  const t = s.table[id]
  if (t) v.table = t
  return normalizeCurveView(v)
}

/** The document's map: every curve that has something to say, nothing else. */
export function collectCurveViews(s: ViewStates): CurveViews {
  const ids = new Set<string>([
    ...Object.keys(s.construction),
    ...Object.keys(s.showParent),
    ...Object.keys(s.factorThrough),
    ...Object.keys(s.motion),
    ...Object.keys(s.lens),
    ...Object.keys(s.table),
  ])
  const out: CurveViews = {}
  for (const id of ids) {
    const v = curveViewOf(s, id)
    if (v) out[id] = v
  }
  return out
}

/**
 * A key that changes exactly when the document's map does — NOT when the
 * particle moves. The autosave listens to this, so a playing particle never
 * schedules a write.
 */
export function curveViewsKey(views: CurveViews): string {
  return JSON.stringify(Object.keys(views).sort().map((id) => [id, views[id]]))
}

/** A Motion player carrying one curve's stored switches, paused at its start. */
function playFrom(v: CurveView, curve: FittedCurve | undefined): MotionPlayState {
  const base = defaultPlay(curve ? motionInterval(curve) : [0, 2 * Math.PI])
  return {
    ...base,
    accel: v.accel === true,
    exportParticle: v.exportParticle === true,
    area: v.area ? { on: v.area.on, a: v.area.a, b: v.area.b } : null,
  }
}

/** Write one curve's stored settings INTO fresh copies of the four maps. */
function put(s: ViewStates, id: string, v: CurveView, curve: FittedCurve | undefined): void {
  if (v.construction) s.construction[id] = true
  if (v.showParent !== undefined) s.showParent[id] = v.showParent
  if (v.through) s.factorThrough[id] = { x: v.through.x, y: v.through.y }
  if (v.area || v.accel || v.exportParticle) s.motion[id] = playFrom(v, curve)
  const l = normalizeLens({ ghost: v.ghost, hlt: v.hlt, reflect: v.reflect })
  if (l) s.lens[id] = l
  const t = normalizeTableView(v.table)
  if (t) s.table[id] = t
}

/** The four maps a freshly loaded document opens with. */
export function viewStatesFrom(views: Readonly<CurveViews>, curves: readonly FittedCurve[]): ViewStates {
  const out = emptyViewStates()
  const byId = new Map(curves.map((c) => [c.id, c]))
  for (const [id, raw] of Object.entries(views)) {
    const v = normalizeCurveView(raw)
    if (v && byId.has(id)) put(out, id, v, byId.get(id))
  }
  return out
}

/** A map without the keys `live` does not hold — the SAME object when none go. */
function keepLive<T>(m: Record<string, T>, live: ReadonlySet<string>): Record<string, T> {
  let dropped = false
  for (const id of Object.keys(m)) {
    if (!live.has(id)) {
      dropped = true
      break
    }
  }
  if (!dropped) return m
  const out: Record<string, T> = {}
  for (const [id, v] of Object.entries(m)) if (live.has(id)) out[id] = v
  return out
}

/**
 * Forget the settings of every curve that is no longer on the board. Each
 * map comes back as the same object when nothing in it went, so a slider
 * frame (curves change, ids do not) re-renders nothing.
 */
export function pruneViewStates(s: ViewStates, live: ReadonlySet<string>): ViewStates {
  const construction = keepLive(s.construction, live)
  const showParent = keepLive(s.showParent, live)
  const factorThrough = keepLive(s.factorThrough, live)
  const motion = keepLive(s.motion, live)
  const lens = keepLive(s.lens, live)
  const table = keepLive(s.table, live)
  if (
    construction === s.construction &&
    showParent === s.showParent &&
    factorThrough === s.factorThrough &&
    motion === s.motion &&
    lens === s.lens &&
    table === s.table
  ) {
    return s
  }
  return { construction, showParent, factorThrough, motion, lens, table }
}

/**
 * Undo / redo: the curves in `curves` that were NOT on the board before
 * (`before`) get back the settings `recorded` holds for them; every curve
 * that stayed keeps what it has now; every curve that left loses its own.
 */
export function restoreViewStates(
  s: ViewStates,
  recorded: Readonly<CurveViews>,
  before: ReadonlySet<string>,
  curves: readonly FittedCurve[],
): ViewStates {
  const live = new Set(curves.map((c) => c.id))
  const pruned = pruneViewStates(s, live)
  let out: ViewStates | null = null
  for (const c of curves) {
    if (before.has(c.id)) continue
    const v = normalizeCurveView(recorded[c.id])
    if (!v) continue
    if (!out) {
      out = {
        construction: { ...pruned.construction },
        showParent: { ...pruned.showParent },
        factorThrough: { ...pruned.factorThrough },
        motion: { ...pruned.motion },
        lens: { ...pruned.lens },
        table: { ...pruned.table },
      }
    }
    // An arriving curve starts from what it recorded, not from anything
    // stale under its id.
    delete out.construction[c.id]
    delete out.showParent[c.id]
    delete out.factorThrough[c.id]
    delete out.motion[c.id]
    delete out.lens[c.id]
    delete out.table[c.id]
    put(out, c.id, v, c)
  }
  return out ?? pruned
}

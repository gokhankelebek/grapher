// ============================================================================
// src/ui/eulerLinks.ts — Euler's method runs on a slope field, as plain data
// plus every pure question the card and the board ask about them.
//
// A run is what a student is handed on the exam — a start point, a step size
// and a number of steps — stored on the field it belongs to (BoardField.eulers
// in src/core/persist.ts). Everything visible is re-asked of the field on
// every change, exactly like a solution curve: the table, the path, the true
// value, the over/under verdict. So dragging a slider on y' = k·y moves the
// whole table live, and nothing stale can ever be saved.
//
// Pure: no React, no DOM, no canvas.
// ============================================================================

import { CURVE_COLORS } from '../core/types'
import type { EulerPath, Polyline, Vec2 } from '../core/types'
import {
  EULER_N_MAX,
  EULER_N_MIN,
  clampEulerN,
  type BoardField,
  type EulerRun,
} from '../core/persist'
import {
  eulerNumber,
  eulerSteps,
  eulerVerdict,
  secondDerivativeOf,
  type EulerNumber,
  type EulerVerdictKind,
  type SecondDerivative,
} from '../core/euler'
import { solveField } from '../core/ode'
import type { CompiledField } from './fieldLinks'
import type { LegendEntry } from './present'

export type { EulerRun }
export { EULER_N_MAX, EULER_N_MIN, clampEulerN }

// ---------------------------------------------------------------------------
// Defaults and edits
// ---------------------------------------------------------------------------

/** The AP default: h = 0.5, four steps. */
export const EULER_DEFAULT_H = 0.5
export const EULER_DEFAULT_N = 4
/** Where a run starts on a field with no solution curve yet. */
export const EULER_DEFAULT_START: Vec2 = { x: 0, y: 1 }

/**
 * The run "+ Euler's method" adds.
 *
 * The first one starts at the field's first initial condition — the point the
 * class has already been looking at — or (0, 1), with h = 0.5 and n = 4.
 * Every later one is the previous run with the step HALVED and the count
 * doubled, so it reaches the same x: comparing h = 0.5 with h = 0.25 is the
 * reason a second run exists at all. When doubling would pass the cap, it
 * keeps the previous run's h and n instead of silently landing somewhere else.
 */
export function defaultRun(field: BoardField): Omit<EulerRun, 'id'> {
  const runs = field.eulers ?? []
  const last = runs[runs.length - 1]
  if (last) {
    const n2 = last.n * 2
    return n2 <= EULER_N_MAX
      ? { x0: last.x0, y0: last.y0, h: last.h / 2, n: n2 }
      : { x0: last.x0, y0: last.y0, h: last.h, n: last.n }
  }
  const s = field.solutions[0]
  const start = s && Number.isFinite(s.x) && Number.isFinite(s.y) ? { x: s.x, y: s.y } : EULER_DEFAULT_START
  return { x0: start.x, y0: start.y, h: EULER_DEFAULT_H, n: EULER_DEFAULT_N }
}

/** The field with one more run. */
export function withRun(field: BoardField, run: EulerRun): BoardField {
  return { ...field, eulers: [...(field.eulers ?? []), run] }
}

/** What the card may change about a run. */
export type RunPatch = Partial<Pick<EulerRun, 'x0' | 'y0' | 'h' | 'n'>> & {
  showTrue?: boolean
  labels?: boolean
}

/**
 * The field with one run changed. An edit that would make the run unsteppable
 * — h = 0, a non-finite number — is refused (the field comes back unchanged),
 * and n is clamped to 1…50, so the card and the loader agree on what a run is.
 * The flags are written only when on, so switching one off and on again does
 * not change a byte.
 */
export function patchRun(field: BoardField, runId: string, patch: RunPatch): BoardField {
  const runs = field.eulers ?? []
  let changed = false
  const next = runs.map((r) => {
    if (r.id !== runId) return r
    const out: EulerRun = { id: r.id, x0: r.x0, y0: r.y0, h: r.h, n: r.n }
    if (r.showTrue) out.showTrue = true
    if (r.labels) out.labels = true
    if (patch.x0 !== undefined) {
      if (!Number.isFinite(patch.x0)) return r
      out.x0 = patch.x0
    }
    if (patch.y0 !== undefined) {
      if (!Number.isFinite(patch.y0)) return r
      out.y0 = patch.y0
    }
    if (patch.h !== undefined) {
      if (!Number.isFinite(patch.h) || patch.h === 0) return r
      out.h = patch.h
    }
    if (patch.n !== undefined) {
      if (!Number.isFinite(patch.n)) return r
      out.n = clampEulerN(patch.n)
    }
    if (patch.showTrue !== undefined) {
      if (patch.showTrue) out.showTrue = true
      else delete out.showTrue
    }
    if (patch.labels !== undefined) {
      if (patch.labels) out.labels = true
      else delete out.labels
    }
    if (
      out.x0 === r.x0 &&
      out.y0 === r.y0 &&
      out.h === r.h &&
      out.n === r.n &&
      !!out.showTrue === !!r.showTrue &&
      !!out.labels === !!r.labels
    ) {
      return r
    }
    changed = true
    return out
  })
  return changed ? { ...field, eulers: next } : field
}

/** The field without one run. The key goes too when the last one does. */
export function withoutRun(field: BoardField, runId: string): BoardField {
  const runs = field.eulers ?? []
  if (!runs.some((r) => r.id === runId)) return field
  const next = runs.filter((r) => r.id !== runId)
  const { eulers: _drop, ...rest } = field
  return next.length > 0 ? { ...rest, eulers: next } : rest
}

/** x₀ + n·h — where the run ends. */
export function eulerTarget(run: Pick<EulerRun, 'x0' | 'h' | 'n'>): number {
  return run.x0 + run.n * run.h
}

// ---------------------------------------------------------------------------
// Looks: one colour and one dash per run
// ---------------------------------------------------------------------------

/**
 * Run i's dash. The first is solid; later ones are dashed, because under an
 * SAT / AP figure every stroke is black and the dash is what is left to tell
 * h = 0.5 from h = 0.25 on paper. (The true solution is dotted — see
 * TRUE_DASH — so it never reads as a run.)
 */
export const RUN_DASHES: readonly (readonly number[])[] = [[], [9, 5], [14, 4, 3, 4], [5, 4]]
export const TRUE_DASH: readonly number[] = [2, 5]
export const TRUE_WIDTH = 2

export function runDash(i: number): readonly number[] {
  return RUN_DASHES[((i % RUN_DASHES.length) + RUN_DASHES.length) % RUN_DASHES.length]
}

/**
 * Run i's colour: a palette colour that is NOT the field's own, so the path
 * stands apart from the lattice and from the solution curves in the field's
 * colour. Palette colours (never a computed tint) so the export's print
 * mapping still knows them.
 */
export function runColor(fieldColor: string, i: number): string {
  const n = CURVE_COLORS.length
  const fi = CURVE_COLORS.indexOf(fieldColor)
  const base = fi < 0 ? 0 : fi
  let c = (base + 3 + i) % n
  if (c === fi) c = (c + 1) % n
  return CURVE_COLORS[c]
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const SUB = '₀₁₂₃₄₅₆₇₈₉'

/** "P₀", "P₁₂". */
export function pointName(k: number): string {
  return 'P' + String(k).replace(/\d/g, (d) => SUB[Number(d)])
}

/** "h = 0.5", "h = −1/4". */
export function stepPhrase(h: number): string {
  return `h = ${eulerNumber(h).text}`
}

/** The legend / caption line for one run: "Euler’s method, h = 0.5". */
export function runCaption(run: Pick<EulerRun, 'h'>): string {
  return `Euler’s method, ${stepPhrase(run.h)}`
}

export const VERDICT_LABEL: Record<EulerVerdictKind, string> = {
  under: 'Underestimate',
  over: 'Overestimate',
  exact: 'Exact',
  unknown: 'Cannot tell from concavity',
}

// ---------------------------------------------------------------------------
// What a card is handed
// ---------------------------------------------------------------------------

export interface EulerCardRow {
  k: number
  x: EulerNumber
  y: EulerNumber
  slope: EulerNumber
  dy: EulerNumber
  /** The last row: its slope and Δy are not used by any step. */
  last: boolean
}

export interface EulerRunCard {
  id: string
  color: string
  dash: readonly number[]
  x0: number
  y0: number
  h: number
  n: number
  x0Text: EulerNumber
  y0Text: EulerNumber
  hText: EulerNumber
  target: EulerNumber
  rows: EulerCardRow[]
  /** Why the table stops short, when it does. */
  stopped: string | null
  /** "y(2) ≈ 2.5" — null when the run could not reach the target. */
  approx: { lhs: string; value: EulerNumber } | null
  /** The true y at the target, when the solution reaches it. */
  trueY: EulerNumber | null
  /** Euler minus true. */
  error: EulerNumber | null
  verdict: {
    kind: EulerVerdictKind
    label: string
    reason: string
    /** d²y/dx² as KaTeX, when it could be derived. */
    d2tex: string | null
    /** Set when the actual error has the other sign — an unstable step. */
    caution: string | null
  } | null
  showTrue: boolean
  labels: boolean
  caption: string
}

/** secondDerivativeOf, memoised on the equation text. */
const D2_CACHE = new Map<string, SecondDerivative | null>()
function d2Of(src: string): SecondDerivative | null {
  if (D2_CACHE.has(src)) return D2_CACHE.get(src) ?? null
  let d: SecondDerivative | null = null
  try {
    d = secondDerivativeOf(src)
  } catch {
    d = null
  }
  if (D2_CACHE.size > 200) D2_CACHE.clear()
  D2_CACHE.set(src, d)
  return d
}

/**
 * Every run's card data for one field, already computed. The card renders it
 * and nothing else, so the table and the path on the board cannot disagree.
 * A field that no longer parses still lists its runs (so they can be edited
 * or removed) with an empty table.
 */
export function eulerCards(
  field: BoardField,
  compiled: Map<string, CompiledField>,
): EulerRunCard[] {
  const runs = field.eulers ?? []
  if (runs.length === 0) return []
  const fn = compiled.get(field.id)?.field?.f ?? null
  const d2 = fn ? d2Of(field.src) : null
  return runs.map((run, i) => {
    const target = eulerTarget(run)
    const base = {
      id: run.id,
      color: runColor(field.color, i),
      dash: runDash(i),
      x0: run.x0,
      y0: run.y0,
      h: run.h,
      n: run.n,
      x0Text: eulerNumber(run.x0),
      y0Text: eulerNumber(run.y0),
      hText: eulerNumber(run.h),
      target: eulerNumber(target),
      showTrue: run.showTrue === true,
      labels: run.labels === true,
      caption: runCaption(run),
    }
    if (!fn) {
      return {
        ...base,
        rows: [],
        stopped: 'the differential equation cannot be read',
        approx: null,
        trueY: null,
        error: null,
        verdict: null,
      }
    }
    const res = eulerSteps(fn, run.x0, run.y0, run.h, run.n)
    const rows: EulerCardRow[] = res.rows.map((r) => ({
      k: r.k,
      x: eulerNumber(r.x),
      y: eulerNumber(r.y),
      slope: eulerNumber(r.slope),
      dy: eulerNumber(r.dy),
      last: r.k === run.n,
    }))
    const reached = res.stopped === null && res.rows.length === run.n + 1
    const yEnd = reached ? res.rows[run.n].y : NaN
    const lhs = `y(${base.target.text})`
    let verdict: EulerRunCard['verdict'] = null
    let trueY: EulerNumber | null = null
    let error: EulerNumber | null = null
    if (reached) {
      const v = eulerVerdict(fn, run.x0, run.y0, target, { d2, yEuler: yEnd })
      if (v.trueY !== null) {
        trueY = eulerNumber(v.trueY)
        error = eulerNumber(yEnd - v.trueY)
      }
      verdict = {
        kind: v.kind,
        label: VERDICT_LABEL[v.kind],
        reason: v.reason,
        d2tex: v.d2 ? v.d2.tex : null,
        caution:
          v.agrees === false
            ? `The computed error has the other sign: with h = ${base.hText.text} the steps are too large for the concavity argument to hold (the method is unstable here).`
            : null,
      }
    }
    return {
      ...base,
      rows,
      stopped: res.stopped ? `Stopped after ${pointName(res.stopped.k)}: ${res.stopped.reason}.` : null,
      approx: reached ? { lhs, value: eulerNumber(yEnd) } : null,
      trueY,
      error,
      verdict,
    }
  })
}

// ---------------------------------------------------------------------------
// What the board draws
// ---------------------------------------------------------------------------

export interface EulerScene {
  paths: EulerPath[]
  /** The true solutions of runs whose "Show the actual solution" is on. */
  polylines: Polyline[]
}

const EMPTY_SCENE: EulerScene = { paths: [], polylines: [] }

/**
 * Every run on every visible field, as figure content. The true solution
 * through a run's start is integrated across `span` — the same span the
 * field's own solution curves use — and drawn dotted in the run's colour.
 */
export function eulerScene(
  fields: readonly BoardField[],
  compiled: Map<string, CompiledField>,
  span: readonly [number, number],
): EulerScene {
  let any = false
  for (const f of fields) if (f.visible && f.eulers && f.eulers.length > 0) any = true
  if (!any) return EMPTY_SCENE
  const paths: EulerPath[] = []
  const polylines: Polyline[] = []
  for (const f of fields) {
    if (!f.visible || !f.eulers || f.eulers.length === 0) continue
    const fn = compiled.get(f.id)?.field?.f
    if (!fn) continue
    f.eulers.forEach((run, i) => {
      const color = runColor(f.color, i)
      const res = eulerSteps(fn, run.x0, run.y0, run.h, run.n)
      const pts = res.rows.map((r) => ({ x: r.x, y: r.y }))
      if (pts.length === 0) return
      const path: EulerPath = {
        id: `euler:${run.id}`,
        pts,
        color,
        tag: stepPhrase(run.h),
      }
      const dash = runDash(i)
      if (dash.length > 0) path.dash = dash
      if (run.labels) path.labels = pts.map((_p, k) => pointName(k))
      paths.push(path)
      if (run.showTrue) {
        let sol: Vec2[] = []
        try {
          sol = solveField(fn, { x: run.x0, y: run.y0 }, [span[0], span[1]])
        } catch {
          sol = []
        }
        if (sol.length >= 2) {
          polylines.push({ id: `euler-true:${run.id}`, pts: sol, color, width: TRUE_WIDTH, dash: TRUE_DASH })
        }
      }
    })
  }
  return { paths, polylines }
}

/** Does any visible field have a run whose true solution is drawn? */
export function needsTrueSolve(fields: readonly BoardField[]): boolean {
  return fields.some((f) => f.visible && (f.eulers ?? []).some((r) => r.showTrue === true))
}

/**
 * The runs as chips on the projected legend: "Euler’s method, h = 0.5" in the
 * run's colour, so a class comparing two step sizes can tell which is which.
 */
export function eulerLegend(
  fields: readonly BoardField[],
  compiled: Map<string, CompiledField>,
): LegendEntry[] {
  const out: LegendEntry[] = []
  for (const f of fields) {
    if (!f.visible || !f.eulers || !compiled.get(f.id)?.field) continue
    f.eulers.forEach((run, i) => {
      const h = eulerNumber(run.h)
      out.push({
        id: `euler:${run.id}`,
        color: runColor(f.color, i),
        tex: `\\text{Euler's method, } h = ${h.tex}`,
        text: runCaption(run),
      })
    })
  }
  return out
}

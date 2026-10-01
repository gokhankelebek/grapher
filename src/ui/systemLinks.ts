// ============================================================================
// src/ui/systemLinks.ts — the inequalities on a board, taken together.
//
// The SYSTEM is every visible inequality on the board: hide a card and it
// leaves the system, show it and it is back. That is the minimal model — no
// list of ids to keep in step with the curves — and it is how a teacher
// already works (add a constraint, hide one to ask "what if"). The document
// stores only what was set for the system (src/core/persist.ts
// BoardIneqSystem); everything here is recomputed from the curves:
//
//   systemCard     the system card's data: the members, the test point's
//                  verdict for each ("(1, 2): 2 < 1² − 4 → 2 < −3 ✗"), and —
//                  when every inequality is linear — the feasible region's
//                  corners (exact), bounded or not, and the objective's table
//   systemOverlays what the board marks: the corners and their labels, the
//                  optimum, the dashed iso-profit line, the test point
// ============================================================================

import type { FittedCurve, InequalityInfo, ModelSpec, Vec2 } from '../core/types'
import type { BoardIneqSystem } from '../core/persist'
import type { Overlay } from '../render/overlays'
import { inequalityOf } from '../render/inequalities'
import { pointLabel, testSentence } from '../core/inequality2d'
import { feasibleRegion, optimize, parseObjective } from '../core/linprog'
import type { FeasibleRegion, LinConstraint, LpResult, Objective } from '../core/linprog'
import { SYSTEM_KEY } from './reveal'

/** Corner marks, the optimum and the test point, in palette colours (print-mapped on paper). */
export const CORNER_COLOR = '#f9a825'
export const OPTIMUM_COLOR = '#f95f62'
export const TEST_COLOR = '#c678dd'

export interface SystemMember {
  id: string
  latex: string
  color: string
  info: InequalityInfo
}

export interface SystemCardData {
  members: SystemMember[]
  /** The test point's verdict per inequality, and for the whole system. */
  test: {
    point: Vec2
    label: string
    rows: { id: string; color: string; ok: boolean; text: string }[]
    all: boolean
  } | null
  /** Linear programming, when every member is linear. */
  lp: {
    region: FeasibleRegion
    /** "Bounded feasible region with 4 corners." */
    status: string
    objective: {
      src: string
      goal: 'max' | 'min'
      obj: Objective | null
      error: string | null
      result: LpResult | null
    } | null
  } | null
  /** Why there is no linear programming section, when there are members but not all linear. */
  notLinear: string | null
}

/** The visible inequalities on the board, in board order. */
export function systemMembers(
  curves: readonly FittedCurve[],
  models: Record<string, ModelSpec>,
): SystemMember[] {
  const out: SystemMember[] = []
  for (const c of curves) {
    if (!c.visible) continue
    const info = inequalityOf(c, models)
    if (!info) continue
    let latex = ''
    try {
      latex = models[c.modelId]?.latex(c.params) ?? ''
    } catch {
      latex = ''
    }
    out.push({ id: c.id, latex, color: c.color, info })
  }
  return out
}

/** Every inequality on the board, hidden ones too (the card counts them). */
export function inequalityCount(curves: readonly FittedCurve[], models: Record<string, ModelSpec>): number {
  return curves.filter((c) => typeof models[c.modelId]?.inequality === 'function').length
}

function constraintsOf(members: readonly SystemMember[]): LinConstraint[] | null {
  const out: LinConstraint[] = []
  for (const m of members) {
    for (const p of m.info.parts) {
      if (!p.linear) return null
      out.push({ a: p.linear.a, b: p.linear.b, c: p.linear.c, strict: p.strict })
    }
  }
  return out
}

function regionStatus(r: FeasibleRegion): string {
  if (r.status === 'empty') return 'No solution: no point satisfies every inequality (the feasible region is empty).'
  const n = r.vertices.length
  const corners = n === 0 ? 'no corners' : n === 1 ? '1 corner' : `${n} corners`
  if (r.status === 'bounded') return `Bounded feasible region with ${corners}.`
  return `Unbounded feasible region with ${corners}.`
}

/** Everything the system card shows. Null when there is no inequality on the board. */
export function systemCard(
  curves: readonly FittedCurve[],
  models: Record<string, ModelSpec>,
  system: BoardIneqSystem | null,
): SystemCardData | null {
  const members = systemMembers(curves, models)
  if (members.length === 0) return null

  let test: SystemCardData['test'] = null
  if (system?.test) {
    const p = system.test
    const rows = members.map((m) => {
      const t = testSentence(m.info, p)
      return { id: m.id, color: m.color, ok: t.ok, text: t.text.replace(/^\([^)]*\):\s*/, '') }
    })
    test = { point: p, label: pointLabel(p), rows, all: rows.every((r) => r.ok) }
  }

  let lp: SystemCardData['lp'] = null
  let notLinear: string | null = null
  const cons = constraintsOf(members)
  if (cons) {
    const region = feasibleRegion(cons)
    let objective: NonNullable<SystemCardData['lp']>['objective'] = null
    if (system?.objective) {
      const o = parseObjective(system.objective.src)
      const goal = system.objective.goal
      objective = o.ok
        ? { src: system.objective.src, goal, obj: o.obj, error: null, result: optimize(region, o.obj, goal) }
        : { src: system.objective.src, goal, obj: null, error: o.error, result: null }
    }
    lp = { region, status: regionStatus(region), objective }
  } else {
    const bad = members.find((m) => m.info.parts.some((p) => !p.linear))
    notLinear = bad
      ? 'Linear programming needs every inequality to be linear (like 2x + 3y ≤ 12).'
      : null
  }
  return { members, test, lp, notLinear }
}

/** The corners are marked while the solution region is shown or an objective is set. */
export function cornersShown(system: BoardIneqSystem | null): boolean {
  return system?.solution === true || system?.objective !== undefined
}

/** What the board marks for the system. */
export function systemOverlays(
  card: SystemCardData | null,
  system: BoardIneqSystem | null,
  /**
   * answers: false — a STUDENT copy (worksheets): the corners stay as dots,
   * but their coordinates, the optimum (its colour, its "max P = …" chip)
   * and the iso-profit line through it are the questions, so they go.
   * Absent: everything, as the board draws it.
   */
  opts: { answers?: boolean } = {},
): Overlay[] {
  if (!card || !system) return []
  const answers = opts.answers !== false
  const out: Overlay[] = []
  const lp = card.lp
  if (lp && lp.region.vertices.length > 0 && cornersShown(system)) {
    const vs = lp.region.vertices
    let cx = 0
    let cy = 0
    for (const v of vs) {
      cx += v.x
      cy += v.y
    }
    cx /= vs.length
    cy /= vs.length
    for (const r of lp.region.rays) {
      cx += r.x
      cy += r.y
    }
    const result = lp.objective?.result ?? null
    const best = new Set(answers && result?.status === 'optimal' ? (result.at ?? []) : [])
    const iso = answers && system.iso === true && result?.status === 'optimal' && result.at && result.at.length > 0 && lp.objective?.obj
    if (iso && lp.objective?.obj && result?.at) {
      const o = lp.objective.obj
      const at = result.at[0]
      if (Math.abs(o.q) > 1e-12) out.push({ kind: 'line', at: { x: at.x, y: at.y }, slope: -o.p / o.q, dashed: true, color: OPTIMUM_COLOR })
      else out.push({ kind: 'segment', from: { x: at.x, y: at.y - 1e3 }, to: { x: at.x, y: at.y + 1e3 }, dashed: true, color: OPTIMUM_COLOR })
    }
    for (const v of vs) {
      const isBest = best.has(v)
      const color = isBest ? OPTIMUM_COLOR : CORNER_COLOR
      out.push({ kind: 'dot', at: { x: v.x, y: v.y }, color, hollow: v.onStrict })
      let dx = v.x - cx
      let dy = v.y - cy
      const n = Math.hypot(dx, dy)
      if (n > 1e-12) {
        dx /= n
        dy /= n
      } else {
        dx = 0.6
        dy = 0.8
      }
      const text =
        isBest && result?.status === 'optimal' && lp.objective?.obj
          ? `${v.label}  ${lp.objective.goal} ${lp.objective.obj.name} = ${result.valueText}`
          : v.label
      if (answers) out.push({ kind: 'label', at: { x: v.x, y: v.y }, text, dir: { x: dx, y: -dy }, color, answer: SYSTEM_KEY })
    }
  }
  if (card.test) {
    const p = card.test.point
    out.push({ kind: 'dot', at: p, color: TEST_COLOR })
    out.push({
      kind: 'label',
      at: p,
      text: `${card.test.label} ${card.test.all ? '✓' : '✗'}`,
      dir: { x: 0.7, y: -0.7 },
      color: TEST_COLOR,
    })
  }
  return out
}

/**
 * The solution region is drawn only while there is a system to intersect:
 * "show solution region" on, and two or more inequalities on the board
 * (BoardScene.inequalitySolution).
 */
export function systemSolutionShown(card: SystemCardData | null, system: BoardIneqSystem | null): boolean {
  return system?.solution === true && (card?.members.length ?? 0) >= 2
}

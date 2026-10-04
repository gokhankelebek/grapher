// ============================================================================
// src/ui/relatedRatesLinks.ts — the App's half of the related-rates object.
//
// The document stores a BoardRelatedRates (src/core/persist.ts): the scenario,
// its givens, the instant t, the "when x = 6" question and two switches. This
// file turns that into
//
//   relatedRatesFigure()  what the board draws (src/render/relatedRates.ts):
//                         the wall, floor and ladder; the cone and its water;
//                         the lamp, the person and the shadow; the ripple;
//                         the balloon — with live values and rate arrows, and
//                         the mini-graph of the unknown rate against t
//   relatedRatesCard()    what the card prints: the givens, the relation, its
//                         derivative, the solved rate, the live values
//   relatedRatesBox()     the frame "Zoom to it" and a fitted export ask for
//   playStep()            the animation clock
//
// so the board and the card read the same numbers and cannot disagree.
// ============================================================================

import type { Vec2 } from '../core/types'
import type { BoardRelatedRates } from '../core/persist'
import { RR_COLOR_DEFAULT } from '../core/persist'
import {
  RR_DEFS,
  dec,
  defaultParams,
  rateForm,
  rateSeries,
  rrState,
  solveWhen,
  decExact,
} from '../core/relatedRates'
import type { Formula, Params, RRScenario, RRScenarioDef, RRState } from '../core/relatedRates'
import type { RRGraph, RRPrim, RelatedRatesFigure } from '../render/relatedRates'

export type { BoardRelatedRates }

export function newRelatedRates(id: string, scenario: RRScenario = 'ladder'): BoardRelatedRates {
  const params = defaultParams(scenario)
  const when = RR_DEFS[scenario].defaultWhen
  const solved = solveWhen(scenario, params, when.q, when.v)
  return {
    id,
    scenario,
    params,
    t: solved.ok ? solved.t : 0,
    when: { q: when.q, v: when.v },
    color: RR_COLOR_DEFAULT,
  }
}

/** Switch scenario: that scenario's own givens and its AP question, answered. */
export function switchScenario(rr: BoardRelatedRates, scenario: RRScenario): BoardRelatedRates {
  const fresh = newRelatedRates(rr.id, scenario)
  const out: BoardRelatedRates = { ...fresh, color: rr.color }
  if (rr.pause) out.pause = true
  if (rr.graph === false) out.graph = false
  if (rr.hidden) out.hidden = true
  return out
}

export const tMaxOf = (rr: BoardRelatedRates): number => RR_DEFS[rr.scenario].tMax(rr.params)

// ---------------------------------------------------------------------------
// The scene: a fixed frame over the whole run, so nothing jumps while it plays
// ---------------------------------------------------------------------------

interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** The largest value `q` takes over the run. */
function maxOver(rr: BoardRelatedRates, q: string): number {
  const T = tMaxOf(rr)
  let m = 0
  for (let i = 0; i <= 40; i++) {
    const s = rrState(rr.scenario, rr.params, (T * i) / 40)
    const v = s.q[q]
    if (Number.isFinite(v)) m = Math.max(m, v)
  }
  return m
}

function sceneBox(rr: BoardRelatedRates): Box {
  const p = rr.params
  switch (rr.scenario) {
    case 'ladder':
      return { x0: -0.12 * p.L, y0: -0.16 * p.L, x1: 1.12 * p.L, y1: 1.18 * p.L }
    case 'cone':
      return { x0: -1.6 * p.R, y0: -0.3 * p.H, x1: 1.6 * p.R, y1: 1.45 * p.H }
    case 'shadow': {
      const tip = Math.max(maxOver(rr, 'tip'), p.x0 + 1)
      const w = Math.max(tip, p.H)
      return { x0: -0.1 * w, y0: -0.2 * p.H, x1: 1.06 * tip, y1: 1.2 * p.H }
    }
    case 'ripple': {
      const r = Math.max(maxOver(rr, 'r'), 0.5)
      return { x0: -1.2 * r, y0: -1.2 * r, x1: 1.2 * r, y1: 1.3 * r }
    }
    case 'balloon': {
      const r = Math.max(maxOver(rr, 'r'), 0.5)
      return { x0: -1.25 * r, y0: -1.6 * r, x1: 1.25 * r, y1: 1.35 * r }
    }
  }
}

function graphBox(sb: Box): Box {
  const W = sb.x1 - sb.x0
  const H = sb.y1 - sb.y0
  // A wide scene (the shadow) takes its graph ABOVE, where a square board has room.
  if (W > 1.8 * H) {
    const x1 = sb.x1
    const y0 = sb.y1 + 0.04 * W
    return { x0: x1 - 0.36 * W, x1, y0, y1: y0 + 0.24 * W }
  }
  const size = Math.max(W, H)
  const x0 = sb.x1 + 0.06 * size
  return { x0, x1: x0 + 0.52 * size, y1: sb.y1, y0: sb.y1 - 0.36 * size }
}

export interface RRBox {
  min: Vec2
  max: Vec2
}

/** The frame: the scene, and the mini-graph beside it when it is on. */
export function relatedRatesBox(rr: BoardRelatedRates): RRBox {
  const sb = sceneBox(rr)
  const b = rr.graph === false ? sb : union(sb, graphBox(sb))
  const padX = 0.05 * (b.x1 - b.x0)
  const padY = 0.06 * (b.y1 - b.y0)
  return { min: { x: b.x0 - padX, y: b.y0 - padY }, max: { x: b.x1 + padX, y: b.y1 + padY } }
}

const union = (a: Box, b: Box): Box => ({
  x0: Math.min(a.x0, b.x0),
  y0: Math.min(a.y0, b.y0),
  x1: Math.max(a.x1, b.x1),
  y1: Math.max(a.y1, b.y1),
})

// ---------------------------------------------------------------------------
// Words and numbers
// ---------------------------------------------------------------------------

/** "−3/2" when exact, "−1.500" otherwise. */
export function rateText(v: number): string {
  const f = rateForm(v)
  return f.exact ? f.exact.text : f.decimal
}

function rateTex(v: number): string {
  const f = rateForm(v)
  return f.exact ? f.exact.tex : f.decimal.replace('−', '-')
}

const one = (v: number): string => dec(v, Math.abs(v) >= 100 ? 0 : 1)

// ---------------------------------------------------------------------------
// The figure
// ---------------------------------------------------------------------------

export interface FigureOpts {
  /** t while the animation runs (the document keeps its own until it stops). */
  playT?: number | null
}

export function relatedRatesFigure(rr: BoardRelatedRates, opts: FigureOpts = {}): RelatedRatesFigure {
  const t = typeof opts.playT === 'number' && Number.isFinite(opts.playT) ? opts.playT : rr.t
  const def = RR_DEFS[rr.scenario]
  const p = rr.params
  const s = rrState(rr.scenario, p, t)
  const sb = sceneBox(rr)
  const prims = scenePrims(rr.scenario, def, p, s, sb)
  let graph: RRGraph | null = null
  if (rr.graph !== false) {
    const pts = rateSeries(rr.scenario, p)
    const vals = pts.map((q) => q.v).filter(Number.isFinite)
    if (vals.length > 1) {
      const sorted = vals.map(Math.abs).sort((a, b) => a - b)
      const cap = 3 * (sorted[Math.floor(0.8 * (sorted.length - 1))] || 1)
      const clipped = vals.map((v) => Math.max(-cap, Math.min(cap, v)))
      let lo = Math.min(0, ...clipped)
      let hi = Math.max(0, ...clipped)
      if (hi - lo < 1e-9) {
        lo -= 1
        hi += 1
      }
      const padV = 0.08 * (hi - lo)
      graph = {
        box: graphBox(sb),
        pts,
        t1: def.tMax(p),
        vLo: lo - padV,
        vHi: hi + padV,
        now: s.valid ? { t: s.t, v: s.unknown } : null,
        yLabel: `${def.unknown.label} (${def.unknown.unit}) vs t`,
        xLabel: `t (${def.timeUnit})`,
      }
    }
  }
  const unknown = s.valid ? `${def.unknown.label} = ${rateText(s.unknown)} ${def.unknown.unit}` : `${def.unknown.label}: —`
  return {
    id: rr.id,
    visible: rr.hidden !== true,
    color: rr.color,
    prims,
    graph,
    title: { at: { x: (sb.x0 + sb.x1) / 2, y: sb.y1 }, text: `t = ${decExact(s.t, 2)} ${def.timeUnit} · ${unknown}` },
    answers: def.extra ? [def.unknown.label, def.extra.label] : [def.unknown.label],
  }
}

function scenePrims(sc: RRScenario, def: RRScenarioDef, p: Params, s: RRState, sb: Box): RRPrim[] {
  const L = def.lenUnit
  const T = def.timeUnit
  const out: RRPrim[] = []
  const size = Math.max(sb.x1 - sb.x0, sb.y1 - sb.y0)
  switch (sc) {
    case 'ladder': {
      const { x, y } = s.q
      out.push({ k: 'hatch', a: { x: -0.08 * p.L, y: 0 }, b: { x: 1.08 * p.L, y: 0 }, side: { x: 0, y: -1 } })
      out.push({ k: 'hatch', a: { x: 0, y: 0 }, b: { x: 0, y: 1.08 * p.L }, side: { x: -1, y: 0 } })
      out.push({ k: 'right', at: { x: 0, y: 0 }, u: { x: 1, y: 0 }, v: { x: 0, y: 1 } })
      out.push({ k: 'line', a: { x, y: 0 }, b: { x: 0, y }, ink: 'main', w: 5 })
      out.push({ k: 'dot', at: { x, y: 0 }, ink: 'main' }, { k: 'dot', at: { x: 0, y }, ink: 'main' })
      out.push({ k: 'dim', a: { x: 0, y: 0 }, b: { x, y: 0 }, ink: 'q1', label: `x = ${one(x)} ${L}`, off: { x: 0, y: 26 } })
      out.push({ k: 'dim', a: { x: 0, y: 0 }, b: { x: 0, y }, ink: 'q2', label: `y = ${one(y)} ${L}`, off: { x: -26, y: 0 } })
      out.push({ k: 'label', at: { x: x / 2, y: y / 2 }, text: `L = ${one(p.L)} ${L}`, ink: 'main', dir: { x: 1, y: -1 } })
      const len = 0.16 * p.L
      if (p.c !== 0) {
        out.push({
          k: 'arrow',
          from: { x, y: 0.03 * p.L },
          to: { x: x + Math.sign(p.c) * len, y: 0.03 * p.L },
          ink: 'q1',
          label: `dx/dt = ${rateText(p.c)} ${L}/${T}`,
        })
      }
      if (s.valid && Number.isFinite(s.unknown) && s.unknown !== 0) {
        const k = Math.max(0.35, Math.min(2.5, Math.abs(s.unknown / (p.c || 1))))
        out.push({
          k: 'arrow',
          from: { x: 0.03 * p.L, y },
          to: { x: 0.03 * p.L, y: y + Math.sign(s.unknown) * len * k },
          ink: 'rate',
          label: `dy/dt = ${rateText(s.unknown)} ${L}/${T}`,
        })
      }
      break
    }
    case 'cone': {
      const { h, r } = s.q
      const R = p.R
      const H = p.H
      out.push({ k: 'poly', pts: [{ x: -R, y: H }, { x: 0, y: 0 }, { x: R, y: H }], ink: 'ground', w: 2.5, closed: false })
      out.push({ k: 'line', a: { x: -R, y: H }, b: { x: R, y: H }, ink: 'faint', w: 1.5, dash: [6, 5] })
      if (h > 0) {
        out.push({ k: 'poly', pts: [{ x: -r, y: h }, { x: 0, y: 0 }, { x: r, y: h }], ink: 'water', fill: 0.42, w: 1.5 })
        out.push({ k: 'line', a: { x: -r, y: h }, b: { x: r, y: h }, ink: 'water', w: 3 })
      }
      out.push({ k: 'dim', a: { x: -1.12 * R, y: 0 }, b: { x: -1.12 * R, y: h }, ink: 'q1', label: `h = ${dec(h, 2)} ${L}`, off: { x: -8, y: 0 } })
      if (r > 0) out.push({ k: 'dim', a: { x: 0, y: h }, b: { x: r, y: h }, ink: 'q2', label: `r = ${dec(r, 2)} ${L}`, off: { x: 0, y: -14 } })
      out.push({ k: 'dim', a: { x: 1.12 * R, y: 0 }, b: { x: 1.12 * R, y: H }, ink: 'faint', label: `H = ${one(H)} ${L}`, off: { x: 8, y: 0 } })
      out.push({ k: 'dim', a: { x: 0, y: H }, b: { x: R, y: H }, ink: 'faint', label: `R = ${one(R)} ${L}`, off: { x: 0, y: -16 } })
      const flow = `dV/dt = ${rateText(p.k)} ${L}³/${T}`
      if (p.k > 0) out.push({ k: 'arrow', from: { x: -0.45 * R, y: 1.38 * H }, to: { x: -0.45 * R, y: 1.04 * H }, ink: 'water', label: flow })
      else if (p.k < 0) out.push({ k: 'arrow', from: { x: 0, y: 0 }, to: { x: 0, y: -0.24 * H }, ink: 'water', label: flow })
      if (s.valid && Number.isFinite(s.unknown) && s.unknown !== 0 && h > 0) {
        const len = 0.14 * H
        out.push({
          k: 'arrow',
          from: { x: -0.55 * r, y: h },
          to: { x: -0.55 * r, y: h + Math.sign(s.unknown) * len },
          ink: 'rate',
          label: `dh/dt = ${rateText(s.unknown)} ${L}/${T}`,
        })
      }
      out.push({ k: 'dot', at: { x: 0, y: 0 }, ink: 'ground', r: 3 })
      break
    }
    case 'shadow': {
      const { x, s: sh } = s.q
      const H = p.H
      const P = p.p
      const x1 = sb.x1
      out.push({ k: 'hatch', a: { x: sb.x0 * 0.6, y: 0 }, b: { x: x1, y: 0 }, side: { x: 0, y: -1 } })
      out.push({ k: 'line', a: { x: 0, y: 0 }, b: { x: 0, y: H }, ink: 'ground', w: 4 })
      out.push({ k: 'circle', c: { x: 0, y: H }, r: 0.022 * size, ink: 'light', fill: 1, w: 0 })
      out.push({ k: 'dim', a: { x: 0, y: 0 }, b: { x: 0, y: H }, ink: 'faint', label: `H = ${one(H)} ${L}`, off: { x: -22, y: 0 } })
      if (s.valid) {
        out.push({ k: 'line', a: { x: 0, y: H }, b: { x: x + sh, y: 0 }, ink: 'light', w: 1.5, dash: [7, 5] })
        out.push({ k: 'line', a: { x, y: 0 }, b: { x: x + sh, y: 0 }, ink: 'shadow', w: 8 })
        out.push({ k: 'line', a: { x, y: 0 }, b: { x, y: 0.8 * P }, ink: 'main', w: 5 })
        out.push({ k: 'circle', c: { x, y: 0.9 * P }, r: 0.1 * P, ink: 'main', fill: 1, w: 0 })
        out.push({ k: 'label', at: { x, y: P }, text: `p = ${one(P)} ${L}`, ink: 'main', dir: { x: -1, y: -1 } })
        out.push({ k: 'dim', a: { x: 0, y: 0 }, b: { x, y: 0 }, ink: 'q1', label: `x = ${one(x)} ${L}`, off: { x: 0, y: 24 } })
        out.push({ k: 'dim', a: { x, y: 0 }, b: { x: x + sh, y: 0 }, ink: 'q2', label: `s = ${one(sh)} ${L}`, off: { x: 0, y: 50 } })
        const len = 0.08 * size
        if (p.v !== 0) {
          out.push({
            k: 'arrow',
            from: { x, y: 0.45 * P },
            to: { x: x + Math.sign(p.v) * len, y: 0.45 * P },
            ink: 'q1',
            label: `dx/dt = ${rateText(p.v)} ${L}/${T}`,
          })
          const tip = s.extra ?? 0
          out.push({
            k: 'arrow',
            from: { x: x + sh, y: 0.1 * P },
            to: { x: x + sh + Math.sign(tip) * len * Math.min(2.5, Math.abs(tip / p.v)), y: 0.1 * P },
            ink: 'rate',
            label: `tip: ${rateText(tip)} ${L}/${T}`,
          })
        }
      } else {
        out.push({ k: 'label', at: { x: (sb.x0 + sb.x1) / 2, y: H / 2 }, text: 'the lamp must be taller than the person', ink: 'rate', dir: { x: 0, y: -1 } })
      }
      break
    }
    case 'ripple': {
      const { r, A } = s.q
      if (r > 0) {
        out.push({ k: 'circle', c: { x: 0, y: 0 }, r: r * 0.66, ink: 'water', w: 1, dash: [4, 5] })
        out.push({ k: 'circle', c: { x: 0, y: 0 }, r: r * 0.33, ink: 'water', w: 1, dash: [4, 5] })
        out.push({ k: 'circle', c: { x: 0, y: 0 }, r, ink: 'water', fill: 0.16, w: 3 })
        out.push({ k: 'dim', a: { x: 0, y: 0 }, b: { x: r, y: 0 }, ink: 'q1', label: `r = ${one(r)} ${L}`, off: { x: 0, y: 0 } })
      }
      out.push({ k: 'dot', at: { x: 0, y: 0 }, ink: 'water', r: 3.5 })
      out.push({ k: 'label', at: { x: 0, y: -0.5 * r }, text: `A = ${dec(A, 1)} ${L}²`, ink: 'q2', dir: { x: 0, y: 1 } })
      if (p.c !== 0 && r > 0) {
        const a = (40 * Math.PI) / 180
        const len = 0.18 * size
        const u = { x: Math.cos(a), y: Math.sin(a) }
        out.push({
          k: 'arrow',
          from: { x: r * u.x, y: r * u.y },
          to: { x: (r + Math.sign(p.c) * len) * u.x, y: (r + Math.sign(p.c) * len) * u.y },
          ink: 'q1',
          label: `dr/dt = ${rateText(p.c)} ${L}/${T}`,
        })
      }
      break
    }
    case 'balloon': {
      const { r, V } = s.q
      if (r > 0) {
        out.push({ k: 'circle', c: { x: 0, y: 0 }, r, ink: 'main', fill: 0.22, w: 3 })
        const eq: Vec2[] = []
        for (let i = 0; i <= 48; i++) {
          const a = (i / 48) * Math.PI * 2
          eq.push({ x: r * Math.cos(a), y: 0.28 * r * Math.sin(a) })
        }
        out.push({ k: 'poly', pts: eq, ink: 'main', w: 1, dash: [4, 5] })
        out.push({ k: 'line', a: { x: 0, y: -r }, b: { x: 0.08 * r, y: -1.4 * r }, ink: 'ground', w: 1.5 })
        const a = (30 * Math.PI) / 180
        const u = { x: Math.cos(a), y: Math.sin(a) }
        out.push({ k: 'line', a: { x: 0, y: 0 }, b: { x: r * u.x, y: r * u.y }, ink: 'q1', w: 2 })
        out.push({ k: 'label', at: { x: 0.5 * r * u.x, y: 0.5 * r * u.y }, text: `r = ${dec(r, 2)} ${L}`, ink: 'q1', dir: { x: -0.5, y: -1 } })
        if (s.valid && Number.isFinite(s.unknown) && s.unknown !== 0) {
          const len = 0.16 * size
          out.push({
            k: 'arrow',
            from: { x: r * u.x, y: r * u.y },
            to: { x: (r + Math.sign(s.unknown) * len) * u.x, y: (r + Math.sign(s.unknown) * len) * u.y },
            ink: 'rate',
            label: `dr/dt = ${rateText(s.unknown)} ${L}/${T}`,
          })
        }
      }
      out.push({ k: 'dot', at: { x: 0, y: 0 }, ink: 'main', r: 3 })
      out.push({ k: 'label', at: { x: 0, y: -0.55 * r }, text: `V = ${dec(V, 1)} ${L}³`, ink: 'q2', dir: { x: 0, y: 1 } })
      out.push({ k: 'label', at: { x: 0.08 * r, y: -1.4 * r }, text: `dV/dt = ${rateText(p.k)} ${L}³/${T}`, ink: 'water', dir: { x: 1, y: 0.4 } })
      break
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export interface RRQuantityRow {
  key: string
  label: string
  text: string
}

export interface RelatedRatesCardData {
  def: RRScenarioDef
  state: RRState
  tMax: number
  /** "Ladder · t = 2.50 s · dy/dt = −3/2 ft/s". */
  summary: string
  quantities: RRQuantityRow[]
  /** The unknown rate: "−3/2", "−1.500" and its unit. */
  unknown: { label: string; text: string; tex: string; decimal: string; unit: string; exact: boolean } | null
  extra: { label: string; text: string; tex: string; unit: string } | null
  relationWith: Formula
  substituted: Formula | null
  /** "When x = 6 ft, dy/dt = −3/2 ft/s: y is decreasing at 3/2 ft/s." */
  answer: string | null
  /** The when-question's solution, or why there is none. */
  when: { q: string; v: number; ok: boolean; t: number | null; error: string | null } | null
}

export function relatedRatesCard(rr: BoardRelatedRates, playT: number | null = null): RelatedRatesCardData {
  const def = RR_DEFS[rr.scenario]
  const t = playT !== null && Number.isFinite(playT) ? playT : rr.t
  const state = rrState(rr.scenario, rr.params, t)
  const tMax = def.tMax(rr.params)
  const quantities = def.quantities.map((q) => ({
    key: q.key,
    label: q.label,
    text: `${decExact(state.q[q.key], 3)} ${q.unit}`,
  }))
  let unknown: RelatedRatesCardData['unknown'] = null
  if (state.valid && Number.isFinite(state.unknown)) {
    const f = rateForm(state.unknown)
    unknown = {
      label: def.unknown.label,
      text: f.exact ? f.exact.text : f.decimal,
      tex: rateTex(state.unknown),
      decimal: f.decimal,
      unit: def.unknown.unit,
      exact: f.exact !== null,
    }
  }
  const extra =
    def.extra && state.extra !== null && Number.isFinite(state.extra)
      ? { label: def.extra.label, text: rateText(state.extra), tex: rateTex(state.extra), unit: def.extra.unit }
      : null
  let when: RelatedRatesCardData['when'] = null
  if (rr.when) {
    const r = solveWhen(rr.scenario, rr.params, rr.when.q, rr.when.v)
    when = r.ok
      ? { q: rr.when.q, v: rr.when.v, ok: true, t: r.t, error: null }
      : { q: rr.when.q, v: rr.when.v, ok: false, t: null, error: r.error }
  }
  // The AP sentence, at the when-instant when t is there, else at t.
  let answer: string | null = null
  if (unknown) {
    const at =
      when && when.ok && when.t !== null && Math.abs(when.t - state.t) <= 1e-9 * Math.max(1, tMax)
        ? `When ${qLabel(def, when.q)} = ${dec(when.v, 3).replace(/\.?0+$/, '')} ${qUnit(def, when.q)}`
        : `At t = ${decExact(state.t, 2)} ${def.timeUnit}`
    const what = def.unknown.label.replace(/^d/, '').replace(/\/dt$/, '')
    const mag = rateText(Math.abs(state.unknown))
    const trend = state.unknown > 0 ? `is increasing at ${mag}` : state.unknown < 0 ? `is decreasing at ${mag}` : 'is not changing'
    answer = `${at}, ${def.unknown.label} = ${unknown.text} ${unknown.unit}: ${what} ${trend}${state.unknown === 0 ? '' : ` ${def.unknown.unit}`}.`
  }
  const substituted = state.valid ? def.substituted(rr.params, state) : null
  const summary = `${def.title} · t = ${decExact(state.t, 2)} ${def.timeUnit}${
    unknown ? ` · ${def.unknown.label} = ${unknown.text} ${unknown.unit}` : ''
  }`
  return {
    def,
    state,
    tMax,
    summary,
    quantities,
    unknown,
    extra,
    relationWith: def.relationWith(rr.params),
    substituted,
    answer,
    when,
  }
}

const qLabel = (def: RRScenarioDef, q: string): string => def.quantities.find((d) => d.key === q)?.label ?? q
const qUnit = (def: RRScenarioDef, q: string): string => def.quantities.find((d) => d.key === q)?.unit ?? ''

// ---------------------------------------------------------------------------
// Play
// ---------------------------------------------------------------------------

export const RR_SPEEDS = [0.5, 1, 2] as const
export type RRSpeed = (typeof RR_SPEEDS)[number]

/** A whole run lasts about this many seconds at 1× (never faster than real time). */
const RUN_SECONDS = 8

/**
 * One animation frame: t advanced by dt real seconds at `speed`. `stopAt` is
 * the when-instant to pause at (when that switch is on). Done at the end of
 * the run, or on reaching stopAt.
 */
export function rrPlayStep(
  t: number,
  dt: number,
  speed: number,
  tMax: number,
  stopAt: number | null = null,
): { t: number; done: boolean } {
  const rate = Math.max(tMax / RUN_SECONDS, Math.min(1, tMax / 2))
  const next = t + dt * speed * rate
  if (stopAt !== null && t < stopAt - 1e-12 && next >= stopAt) return { t: stopAt, done: true }
  if (next >= tMax) return { t: tMax, done: true }
  return { t: next, done: false }
}

/** Where Play starts: from t, unless t is at (or past) the end — then from 0. */
export function rrPlayStart(t: number, tMax: number): number {
  return t >= tMax - 1e-9 ? 0 : Math.max(0, t)
}

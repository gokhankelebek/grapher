// ============================================================================
// src/ui/limitLinks.ts — the limit link: lim x→a f(x) on any function, from
// either side or both, at a point or at ±∞, with the AP continuity checklist,
// the table of values and the ε–δ picture.
//
// src/core/limits.ts owns the mathematics (the one-sided limits, f(a), the
// classification, the table, δ). This module owns what a teacher SEES of it:
//
//     lim_{x→3} f(x) = 6
//     lim_{x→3⁻} f(x) = 6,  lim_{x→3⁺} f(x) = 6
//     f(3) is undefined
//     Removable discontinuity (a hole) at (3, 6)
//     ✓ f(3) is defined … ✗    ✓ lim exists    ✗ lim = f(3)
//
// — and the figure: a dashed guide at x = a, arrowheads gliding along the
// curve toward (a, L) from each side (up or down the asymptote when a side is
// infinite), a ring at (a, L) where f(a) is not L, a dot at (a, f(a)) where f
// is defined, and — for ε–δ — the band L ± ε, the band a ± δ and the box they
// share. At ±∞: the dashed line y = L and arrows running out to the edge.
//
// Everything is recomputed from the link { a, side?, table?, epsilon?, eps? }
// on every change; nothing computed is stored. One analysis per (curve, a) is
// cached, so the card and the board — both rebuilt on every frame of a drag —
// share it.
//
// Pure: no React, no DOM, no canvas.
// ============================================================================

import type { FittedCurve, ModelSpec } from '../core/types'
import { CURVE_COLORS } from '../core/types'
import type { Overlay } from '../render/overlays'
import type { LimitLink } from '../core/persist'
import { LIMIT_EPS_DEFAULT } from '../core/persist'
import { exactForm } from '../core/exact'
import { chosenLimit, deltaFor, limitAt, limitPoints, limitSourceOf, limitTable, reachFrom } from '../core/limits'
import type {
  DeltaResult,
  LimitOutcome,
  LimitPoint,
  LimitResult,
  LimitSide,
  LimitSource,
  LimitTable,
} from '../core/limits'
import { decimal, numText } from './secantLinks'

export type { LimitLink }

/** ε's slider: its range and step. */
export const EPS_MIN = 0.01
export const EPS_MAX = 2
export const EPS_STEP = 0.01
/** The two ε–δ bands' wash, and the box's outline weight. */
export const EPS_BAND_ALPHA = 0.14
export const DELTA_BAND_ALPHA = 0.16
export const EPS_BOX_WIDTH = 1.5
/** The guide at x = a. */
export const GUIDE_WIDTH = 1.25
/** A dragged a snaps to a hole, jump or pole within this many pixels. */
export const LIMIT_SNAP_PX = 12

const MINUS = '−'

// ---------------------------------------------------------------------------
// Numbers and points, the way a teacher writes them
// ---------------------------------------------------------------------------

/** "3", "π/2", "−1/3", "∞", "−∞". */
export function aText(a: number): string {
  if (a === Infinity) return '∞'
  if (a === -Infinity) return `${MINUS}∞`
  return numText(a)
}

/** The same, in LaTeX. */
function aTex(a: number): string {
  if (a === Infinity) return '\\infty'
  if (a === -Infinity) return '-\\infty'
  if (a === 0) return '0'
  const ex = exactForm(a)
  if (ex) return ex.tex
  return decimal(a).replace(MINUS, '-')
}

/** "x → 3", "x → 3⁻", "x → ∞" — the subscript under lim, as text. */
function arrowText(a: number, side: LimitSide): string {
  const sup = side === 'left' ? '⁻' : side === 'right' ? '⁺' : ''
  const t = aText(a)
  return `x → ${sup && /[/√]/.test(t) ? `(${t})` : t}${sup}`
}

/** The same, in LaTeX: x \to 3^{-}. */
function arrowTex(a: number, side: LimitSide): string {
  const t = aTex(a)
  if (side === 'both' || !Number.isFinite(a)) return `x \\to ${t}`
  const sup = side === 'left' ? '-' : '+'
  return /\\frac|\\sqrt/.test(t) ? `x \\to \\left(${t}\\right)^{${sup}}` : `x \\to {${t}}^{${sup}}`
}

/** A limit's value: "6", "≈ 0.693", "∞", "−∞", "does not exist", "?". */
export function outcomeText(o: LimitOutcome): string {
  if (o.value === 'DNE') return 'does not exist'
  if (o.value === 'unknown') return '?'
  if (o.value === Infinity) return '∞'
  if (o.value === -Infinity) return `${MINUS}∞`
  if (o.exact) return o.exact.text
  return o.approx ? `≈ ${fourSig(o.value)}` : numText(o.value)
}

/** " = 6", " ≈ 0.693", " does not exist" — what follows "lim f(x)". */
function tail(o: LimitOutcome): string {
  const t = outcomeText(o)
  if (o.value === 'DNE') return ` ${t}`
  return t.startsWith('≈') ? ` ${t}` : ` = ${t}`
}

function tailTex(o: LimitOutcome): string {
  if (o.value === 'DNE') return '\\text{ does not exist}'
  if (o.value === 'unknown') return ' = \\;?'
  if (o.value === Infinity) return ' = \\infty'
  if (o.value === -Infinity) return ' = -\\infty'
  if (o.exact) return ` = ${o.exact.tex}`
  const d = fourSig(o.value).replace(MINUS, '-')
  return o.approx ? ` \\approx ${d}` : ` = ${d}`
}

/** Four significant figures, a real minus sign. */
export function fourSig(v: number): string {
  if (!Number.isFinite(v)) return '—'
  if (v === 0) return '0'
  const mag = Math.abs(v)
  if (mag >= 1e7 || mag < 1e-5) return v.toExponential(3).replace('-', MINUS)
  let s = v.toPrecision(4)
  if (s.includes('e')) s = String(Number(s))
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '')
  return s.replace('-', MINUS)
}

/** "(3, 6)" */
const pointText = (x: number, y: number): string => `(${numText(x)}, ${numText(y)})`

// ---------------------------------------------------------------------------
// The analysis, cached
// ---------------------------------------------------------------------------

export interface LimitAnalysis {
  src: LimitSource | null
  res: LimitResult | null
  /** How far f runs unbroken to the left / right of a finite a (the arrows' track). */
  reach: [number, number]
}

const SERIALS = new WeakMap<object, number>()
let serialNext = 1
const serialOf = (o: object | undefined): number => {
  if (!o) return 0
  let n = SERIALS.get(o)
  if (n === undefined) {
    n = serialNext++
    SERIALS.set(o, n)
  }
  return n
}

const CACHE = new Map<string, LimitAnalysis>()
const CACHE_MAX = 64

const curveKey = (parent: FittedCurve, models: Record<string, ModelSpec>): string =>
  [parent.modelId, serialOf(models[parent.modelId]), parent.params.join(','), parent.domain ? parent.domain.join(',') : ''].join('|')

function remember<T>(map: Map<string, T>, key: string, value: T, max: number): T {
  map.set(key, value)
  while (map.size > max) {
    const oldest = map.keys().next().value
    if (oldest === undefined) break
    map.delete(oldest)
  }
  return value
}

/** The source and lim x→a, for this curve as it is now. */
export function analyzeLimit(
  a: number,
  parent: FittedCurve,
  models: Record<string, ModelSpec>,
): LimitAnalysis {
  const key = `${curveKey(parent, models)}|${a}`
  const hit = CACHE.get(key)
  if (hit) {
    CACHE.delete(key)
    CACHE.set(key, hit)
    return hit
  }
  const out: LimitAnalysis = { src: null, res: null, reach: [0, 0] }
  try {
    out.src = limitSourceOf(parent, models)
  } catch {
    out.src = null
  }
  if (out.src) {
    try {
      out.res = limitAt(out.src, a)
    } catch {
      out.res = null
    }
    if (Number.isFinite(a)) {
      try {
        out.reach = [reachFrom(out.src, a, -1), reachFrom(out.src, a, 1)]
      } catch {
        out.reach = [0, 0]
      }
    }
  }
  return remember(CACHE, key, out, CACHE_MAX)
}

const sideOf = (link: Pick<LimitLink, 'a' | 'side'>): LimitSide =>
  Number.isFinite(link.a) && (link.side === 'left' || link.side === 'right') ? link.side : 'both'

const epsOf = (link: Pick<LimitLink, 'eps'>): number =>
  typeof link.eps === 'number' && Number.isFinite(link.eps) && link.eps > 0 ? link.eps : LIMIT_EPS_DEFAULT

/** The finite L the ε–δ picture is about, or null. */
function finiteL(o: LimitOutcome): number | null {
  return typeof o.value === 'number' && Number.isFinite(o.value) ? o.value : null
}

const DELTA_CACHE = new Map<string, DeltaResult | null>()

/** δ for this link's ε, cached per (curve, a, L, ε, side). */
function deltaOf(
  link: LimitLink,
  parent: FittedCurve,
  models: Record<string, ModelSpec>,
  src: LimitSource,
  L: number,
): DeltaResult | null {
  const side = sideOf(link)
  const eps = epsOf(link)
  const key = `${curveKey(parent, models)}|${link.a}|${L}|${eps}|${side}`
  if (DELTA_CACHE.has(key)) return DELTA_CACHE.get(key) ?? null
  let d: DeltaResult | null = null
  try {
    d = deltaFor(src, link.a, L, eps, side)
  } catch {
    d = null
  }
  return remember(DELTA_CACHE, key, d, CACHE_MAX)
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export interface CheckItem {
  ok: boolean
  text: string
}

export interface TableColumn {
  /** "x → 3⁻" */
  title: string
  rows: { x: string; y: string }[]
}

/** One limit, as its PARENT's card shows it. */
export interface LimitRow {
  linkId: string
  a: number
  /** "3", "π/2", "∞" */
  aText: string
  /** −1 / 1 for x → ∓∞ … ±∞, 0 for a finite a. */
  infinity: -1 | 0 | 1
  side: LimitSide
  table: boolean
  epsilon: boolean
  eps: number
  fName: string
  /** "Limit of f at x = 3", "Left-hand limit of f at x = 3", "Limit of f as x → ∞" */
  title: string
  /** The limit asked for: "lim x→3 f(x) = 6", and its LaTeX. */
  head: { text: string; tex: string }
  /** Both one-sided statements (finite a only). */
  sides: { text: string; tex: string } | null
  /** Why it does not exist / what an infinite limit means / why no answer. */
  why: string | null
  /** "f(3) is undefined", "f(2) = 2"; null at ±∞. */
  fa: string | null
  /** "Removable discontinuity (a hole) at (3, 6)" */
  klass: string | null
  checklist: CheckItem[] | null
  /** "So f is continuous at x = 2." */
  verdict: string | null
  verdictOk: boolean
  /** The table of values, one column per side. */
  columns: TableColumn[] | null
  /** ε–δ: the δ and what it promises, or why there is no picture. */
  delta: { text: string; value: number | null } | null
  problem: string | null
}

/** "f is not defined to the left of 0" — plain words for each DNE reason. */
function whyText(res: LimitResult, chosen: LimitOutcome, side: LimitSide, fName: string): string | null {
  const a = res.a
  const at = aText(a)
  if (!Number.isFinite(a)) {
    if (chosen.value === 'DNE') {
      if (chosen.why === 'undefined') {
        return `${fName} is not defined for ${a > 0 ? 'large positive' : 'large negative'} x.`
      }
      return chosen.bounded === false
        ? `${fName} oscillates with ever larger swings as x → ${at}, so the limit does not exist.`
        : `${fName} keeps oscillating as x → ${at} and approaches no single value, so the limit does not exist.`
    }
    if (chosen.value === 'unknown') {
      return `The values of ${fName} do not settle as x → ${at} (as far as this can check), so no limit is claimed.`
    }
    if (chosen.value === Infinity || chosen.value === -Infinity) {
      return `${fName} ${chosen.value > 0 ? 'grows' : 'decreases'} without bound: there is no horizontal asymptote on this side.`
    }
    return `y = ${outcomeText(chosen)} is a horizontal asymptote as x → ${at}.`
  }
  const L = res.left as LimitOutcome
  const R = res.right as LimitOutcome
  const lim = (o: LimitOutcome): string => outcomeText(o)
  if (chosen.value === 'unknown') {
    return `The values of ${fName} do not settle near x = ${at} (as far as this can check), so no limit is claimed.`
  }
  if (chosen.value === Infinity || chosen.value === -Infinity) {
    const s = chosen.value > 0 ? '∞' : `${MINUS}∞`
    return `${fName}(x) → ${s}: it ${chosen.value > 0 ? 'grows' : 'decreases'} without bound, so x = ${at} is a vertical asymptote. (An infinite limit does not exist as a number; = ${s} says how it fails.)`
  }
  if (chosen.value !== 'DNE') return null
  switch (chosen.why) {
    case 'sides-differ':
      return `The left-hand limit (${lim(L)}) and the right-hand limit (${lim(R)}) are not equal, so the limit does not exist.`
    case 'infinite-signs':
      return `${fName}(x) → ${lim(L)} from the left and ${lim(R)} from the right, so the limit does not exist (x = ${at} is a vertical asymptote).`
    case 'oscillates':
      return chosen.bounded === false
        ? `${fName} oscillates with ever larger swings as x → ${at}, so the limit does not exist.`
        : `${fName} oscillates infinitely often as x → ${at} and approaches no single value, so the limit does not exist.`
    case 'one-sided': {
      const live = res.liveSide === 1 ? R : L
      const word = res.liveSide === 1 ? 'left' : 'right'
      const liveWord = res.liveSide === 1 ? 'right' : 'left'
      const sup = res.liveSide === 1 ? '⁺' : '⁻'
      return `${fName} is not defined to the ${word} of ${at}, so only the ${liveWord}-hand limit can exist: lim x→${at}${sup} ${fName}(x)${tail(live)}.`
    }
    case 'undefined':
      return side === 'both'
        ? `${fName} is not defined near x = ${at}.`
        : `${fName} is not defined to the ${side} of ${at}, so this one-sided limit does not exist.`
  }
  return null
}

/** The classification, in AP words. */
function klassText(res: LimitResult, fName: string): string | null {
  const a = res.a
  if (!Number.isFinite(a)) return null
  const at = aText(a)
  const two = res.two
  switch (res.kind) {
    case 'continuous':
      return `${fName} is continuous at x = ${at}`
    case 'removable': {
      const L = finiteL(two)
      const where = L !== null ? `at ${pointText(a, L)}` : `at x = ${at}`
      return res.fa
        ? `Removable discontinuity ${where}: ${fName}(${at}) is not the limit`
        : `Removable discontinuity (a hole) ${where}`
    }
    case 'jump': {
      const l = res.left ? outcomeText(res.left) : '?'
      const r = res.right ? outcomeText(res.right) : '?'
      return `Jump discontinuity at x = ${at}: the graph jumps from ${l} to ${r}`
    }
    case 'infinite':
      return `Infinite discontinuity: x = ${at} is a vertical asymptote`
    case 'oscillating':
      return `Oscillating discontinuity at x = ${at}`
    case 'endpoint':
      return `x = ${at} is an endpoint of the domain of ${fName}`
    case 'undefined':
      return `${fName} is not defined near x = ${at}`
    case 'unknown':
      return `The behaviour of ${fName} at x = ${at} could not be classified`
    case 'infinity':
      return null
  }
}

/** The AP checklist, each line ticked or crossed, and its verdict. */
function checklistOf(
  res: LimitResult,
  fName: string,
): { items: CheckItem[]; verdict: string; ok: boolean } | null {
  if (!res.checklist || !Number.isFinite(res.a)) return null
  const at = aText(res.a)
  const [c1, c2, c3] = res.checklist
  const oneSided = res.kind === 'endpoint' || (res.kind === 'infinite' && res.liveSide !== undefined)
  const sup = res.liveSide === 1 ? '⁺' : res.liveSide === -1 ? '⁻' : ''
  const limT = `lim x→${at}${oneSided ? sup : ''} ${fName}(x)`
  const items: CheckItem[] = [
    { ok: c1, text: c1 ? `${fName}(${at}) is defined` : `${fName}(${at}) is not defined` },
    {
      ok: c2,
      text: c2
        ? `${limT} exists${oneSided ? ' (one-sided: an endpoint)' : ''}`
        : `${limT} does not exist${oneSided ? ' (one-sided: an endpoint)' : ''}`,
    },
    {
      ok: c3,
      text: c3
        ? `${limT} = ${fName}(${at})`
        : !c1
          ? `${limT} = ${fName}(${at}) cannot hold: ${fName}(${at}) is undefined`
          : !c2
            ? `${limT} = ${fName}(${at}) cannot hold: there is no limit`
            : `${limT} ≠ ${fName}(${at})`,
    },
  ]
  const ok = c1 && c2 && c3
  let verdict: string
  if (ok && res.kind === 'endpoint') {
    verdict = `So ${fName} is continuous from the ${res.liveSide === 1 ? 'right' : 'left'} at x = ${at}, an endpoint of its domain.`
  } else if (ok) {
    verdict = `So ${fName} is continuous at x = ${at}.`
  } else {
    const first = !c1 ? 1 : !c2 ? 2 : 3
    verdict = `Condition ${first} fails, so ${fName} is not continuous at x = ${at}.`
  }
  return { items, verdict, ok }
}

/** The table of values as the card shows it. */
function columnsOf(t: LimitTable, a: number): TableColumn[] {
  const out: TableColumn[] = []
  const at = aText(a)
  const shortA = /[/√π]/.test(at) ? `(${at})` : at
  if (t.left) {
    out.push({
      title: Number.isFinite(a) ? `x → ${shortA}⁻` : `x → ${at}`,
      rows: t.left.map((r) => ({ x: r.xText, y: r.yText })),
    })
  }
  if (t.right) {
    out.push({
      title: Number.isFinite(a) ? `x → ${shortA}⁺` : `x → ${at}`,
      rows: t.right.map((r) => ({ x: r.xText, y: r.yText })),
    })
  }
  return out
}

/**
 * What the card says about one limit: the limit asked for, both one-sided
 * limits, why it fails when it does, f(a), what kind of point a is, the AP
 * checklist — and, switched on, the table and ε–δ.
 */
export function limitRow(
  link: LimitLink,
  parent: FittedCurve | undefined,
  models: Record<string, ModelSpec>,
  fName = 'f',
): LimitRow {
  const side = sideOf(link)
  const a = link.a
  const inf: -1 | 0 | 1 = a === Infinity ? 1 : a === -Infinity ? -1 : 0
  const headText = (o: LimitOutcome | null, s: LimitSide = side): string =>
    `lim ${arrowText(a, s)} ${fName}(x)${o ? tail(o) : ''}`
  const headTex = (o: LimitOutcome | null, s: LimitSide = side): string =>
    `\\lim_{${arrowTex(a, s)}} ${fName}(x)${o ? tailTex(o) : ''}`
  const title =
    inf !== 0
      ? `Limit of ${fName} as x → ${aText(a)}`
      : `${side === 'left' ? 'Left-hand limit' : side === 'right' ? 'Right-hand limit' : 'Limit'} of ${fName} at x = ${aText(a)}`
  const row: LimitRow = {
    linkId: link.id,
    a,
    aText: aText(a),
    infinity: inf,
    side,
    table: link.table === true,
    epsilon: link.epsilon === true,
    eps: epsOf(link),
    fName,
    title,
    head: { text: headText(null), tex: headTex(null) },
    sides: null,
    why: null,
    fa: null,
    klass: null,
    checklist: null,
    verdict: null,
    verdictOk: false,
    columns: null,
    delta: null,
    problem: null,
  }
  if (!parent) {
    row.problem = 'the curve it was taken on is gone'
    return row
  }
  if (Number.isNaN(a)) {
    row.problem = 'a is not a number'
    return row
  }
  const an = analyzeLimit(a, parent, models)
  if (!an.src) {
    row.problem = `${fName} is not a function of x`
    return row
  }
  const res = an.res
  if (!res) {
    row.problem = 'this limit could not be measured'
    return row
  }
  const chosen = chosenLimit(res, side)
  row.head = { text: headText(chosen), tex: `\\displaystyle ${headTex(chosen)}` }
  if (inf === 0 && res.left && res.right) {
    // The two one-sided limits, always — they are what the two-sided one is
    // built from, and a one-sided link still wants to see the other side.
    row.sides = {
      text: `${headText(res.left, 'left')},  ${headText(res.right, 'right')}`,
      tex: `${headTex(res.left, 'left')}, \\qquad ${headTex(res.right, 'right')}`,
    }
    row.fa = res.fa
      ? `${fName}(${row.aText}) = ${res.fa.exact ? res.fa.exact.text : fourSig(res.fa.value)}`
      : `${fName}(${row.aText}) is undefined`
    row.klass = klassText(res, fName)
    const ck = checklistOf(res, fName)
    if (ck) {
      row.checklist = ck.items
      row.verdict = ck.verdict
      row.verdictOk = ck.ok
    }
  }
  row.why = whyText(res, chosen, side, fName)

  if (row.table) {
    try {
      row.columns = columnsOf(limitTable(an.src, a, side), a)
    } catch {
      row.columns = null
    }
  }

  if (row.epsilon) {
    const L = finiteL(chosen)
    if (inf !== 0) {
      row.delta = { text: 'The ε–δ picture is for a limit at a point; at ∞ it is an M–ε argument.', value: null }
    } else if (L === null) {
      row.delta = { text: 'The ε–δ picture needs a finite limit L.', value: null }
    } else {
      const d = deltaOf(link, parent, models, an.src, L)
      const eT = fourSig(row.eps)
      const at = row.aText
      // |x − 2|, |x + 1|, |x|; |f(x) − 4|, |f(x) + 2|, |f(x)|
      const dist = (v: string, c: number, cT: string): string =>
        c === 0 ? `|${v}|` : c < 0 ? `|${v} + ${cT.replace(/^[−-]/, '')}|` : `|${v} − ${cT}|`
      const LT = outcomeText(chosen).replace(/^≈ /, '')
      const fDist = dist(`${fName}(x)`, L, LT)
      const cond =
        side === 'left'
          ? (dT: string): string => `${at} − ${dT} < x < ${at}`
          : side === 'right'
            ? (dT: string): string => `${at} < x < ${at} + ${dT}`
            : (dT: string): string => `0 < ${dist('x', a, at)} < ${dT}`
      if (!d) {
        row.delta = { text: 'No δ could be measured here.', value: null }
      } else if (d.capped) {
        const dT = fourSig(d.delta)
        row.delta = {
          text: `Every δ up to ${dT} works: whenever ${cond(dT)}, ${fDist} < ${eT}.`,
          value: d.delta,
        }
      } else {
        const dT = fourSig(d.delta)
        row.delta = {
          text: `δ ≈ ${dT}: whenever ${cond(dT)}, ${fDist} < ${eT}.`,
          value: d.delta,
        }
      }
    }
  }
  return row
}

// ---------------------------------------------------------------------------
// The figure
// ---------------------------------------------------------------------------

/** A second tint for the δ band: amber, unless the curve already is. */
export function deltaTint(color: string): string {
  const amber = CURVE_COLORS[3]
  return color === amber ? CURVE_COLORS[4] : amber
}

/** Far enough to be off any board, near enough to project without overflow. */
const FAR = 1e12

/**
 * Everything the limits draw: the ε–δ bands first (washes, under the curves),
 * then the marks — the guide at x = a, the gliding arrows, the ring at (a, L)
 * and the dot at (a, f(a)), the box and the δ chip. A hidden or missing
 * parent draws nothing.
 */
export function limitOverlays(
  links: readonly LimitLink[],
  curves: readonly FittedCurve[],
  models: Record<string, ModelSpec>,
): Overlay[] {
  const fills: Overlay[] = []
  const lines: Overlay[] = []
  const arrows: Overlay[] = []
  const dots: Overlay[] = []
  const chips: Overlay[] = []
  for (const link of links) {
    const parent = curves.find((c) => c.id === link.parentId)
    if (!parent || !parent.visible) continue
    const a = link.a
    if (Number.isNaN(a)) continue
    let an: LimitAnalysis
    try {
      an = analyzeLimit(a, parent, models)
    } catch {
      continue
    }
    const src = an.src
    const res = an.res
    if (!src || !res) continue
    const id = parent.id
    const side = sideOf(link)
    const f = src.f
    const chosen = chosenLimit(res, side)

    // At ±∞: the asymptote y = L (dashed), and arrows running out to the edge.
    if (!Number.isFinite(a)) {
      const dir: -1 | 1 = a > 0 ? 1 : -1
      const L = finiteL(res.two)
      if (L !== null) lines.push({ kind: 'hline', curveId: id, y: L, dashed: true })
      if (L !== null || res.two.value === Infinity || res.two.value === -Infinity) {
        arrows.push({ kind: 'approach', curveId: id, f, a, side: dir })
      }
      continue
    }

    // The guide at x = a.
    lines.push({
      kind: 'segment',
      curveId: id,
      from: { x: a, y: -FAR },
      to: { x: a, y: FAR },
      dashed: true,
      width: GUIDE_WIDTH,
    })

    // Arrows from each side asked for: along the curve toward (a, L), or up
    // or down the asymptote when that side is infinite.
    const wanted: (-1 | 1)[] = side === 'left' ? [-1] : side === 'right' ? [1] : [-1, 1]
    const ringsAt: number[] = []
    for (const s of wanted) {
      const o = s < 0 ? res.left : res.right
      if (!o || typeof o.value !== 'number') continue
      if (Number.isFinite(o.value)) {
        arrows.push({ kind: 'approach', curveId: id, f, a, side: s, reach: an.reach[s < 0 ? 0 : 1] })
        ringsAt.push(o.value)
      } else {
        arrows.push({
          kind: 'approach',
          curveId: id,
          f,
          a,
          side: s,
          run: o.value > 0 ? 1 : -1,
          reach: an.reach[s < 0 ? 0 : 1],
        })
      }
    }

    // The ring at (a, L) wherever f(a) is not L, and the dot at (a, f(a)).
    const fa = res.fa
    const seen: number[] = []
    for (const y of ringsAt) {
      const tol = 1e-9 * Math.max(1, Math.abs(y))
      if (seen.some((v) => Math.abs(v - y) <= tol)) continue
      seen.push(y)
      if (fa && Math.abs(fa.value - y) <= 1e-6 * Math.max(1, Math.abs(y))) continue
      dots.push({ kind: 'dot', curveId: id, at: { x: a, y }, hollow: true })
    }
    if (fa) dots.push({ kind: 'dot', curveId: id, at: { x: a, y: fa.value } })

    // ε–δ: the classic picture.
    const L = finiteL(chosen)
    if (link.epsilon === true && L !== null) {
      const eps = epsOf(link)
      const d = deltaOf(link, parent, models, src, L)
      const tint = deltaTint(parent.color)
      fills.push({
        kind: 'region',
        boundary: [
          { x: -FAR, y: L - eps },
          { x: FAR, y: L - eps },
          { x: FAR, y: L + eps },
          { x: -FAR, y: L + eps },
        ],
        color: parent.color,
        alpha: EPS_BAND_ALPHA,
      })
      if (d) {
        const x0 = side === 'right' ? a : a - d.delta
        const x1 = side === 'left' ? a : a + d.delta
        fills.push({
          kind: 'region',
          boundary: [
            { x: x0, y: -FAR },
            { x: x1, y: -FAR },
            { x: x1, y: FAR },
            { x: x0, y: FAR },
          ],
          color: tint,
          alpha: DELTA_BAND_ALPHA,
        })
        // The box the two bands share: the graph stays inside it.
        const corners = [
          { x: x0, y: L - eps },
          { x: x1, y: L - eps },
          { x: x1, y: L + eps },
          { x: x0, y: L + eps },
        ]
        for (let i = 0; i < 4; i++) {
          lines.push({
            kind: 'segment',
            color: tint,
            from: corners[i],
            to: corners[(i + 1) % 4],
            width: EPS_BOX_WIDTH,
          })
        }
        chips.push({
          kind: 'label',
          color: tint,
          at: { x: x1, y: L - eps },
          text: `δ ≈ ${fourSig(d.delta)}`,
          dir: { x: 1, y: 1 },
        })
        chips.push({
          kind: 'label',
          curveId: id,
          at: { x: x0, y: L + eps },
          text: `ε = ${fourSig(eps)}`,
          dir: { x: -1, y: -1 },
        })
      }
    }
  }
  return [...fills, ...lines, ...arrows, ...dots, ...chips]
}

// ---------------------------------------------------------------------------
// Where a fresh one opens, and what a dragged a snaps to
// ---------------------------------------------------------------------------

const POINT_CACHE = new Map<string, LimitPoint[]>()

/** The holes, jumps and poles of the curve in the window (cached per curve and window). */
export function limitSnapPoints(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  window: [number, number],
): LimitPoint[] {
  const lo = Math.min(window[0], window[1])
  const hi = Math.max(window[0], window[1])
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) return []
  // The window rounded outward to a coarse grid, so a pan reuses the scan.
  const g = Math.pow(10, Math.floor(Math.log10(hi - lo)) - 1)
  const wlo = Math.floor(lo / g) * g
  const whi = Math.ceil(hi / g) * g
  const key = `${curveKey(curve, models)}|${wlo}|${whi}`
  const hit = POINT_CACHE.get(key)
  if (hit) return hit
  let pts: LimitPoint[] = []
  try {
    const src = limitSourceOf(curve, models)
    pts = src ? limitPoints(src, [wlo, whi]) : []
  } catch {
    pts = []
  }
  return remember(POINT_CACHE, key, pts, 32)
}

/**
 * Where a dragged a lands: on a hole, jump or pole within LIMIT_SNAP_PX of
 * the pointer (the point the lesson is about), else wherever `nice` snaps it.
 */
export function snapLimitA(
  x: number,
  points: readonly LimitPoint[],
  pxPerUnit: number,
  nice: (x: number) => number,
): number {
  if (!Number.isFinite(x)) return x
  const ppu = Number.isFinite(pxPerUnit) && pxPerUnit > 0 ? pxPerUnit : 60
  let best: LimitPoint | null = null
  for (const p of points) {
    const d = Math.abs(p.x - x) * ppu
    if (d <= LIMIT_SNAP_PX && (!best || d < Math.abs(best.x - x) * ppu)) best = p
  }
  if (best) return best.exact ? best.exact.value : best.x
  return nice(x)
}

/**
 * a for a fresh limit, in this order: the hole, jump or pole in view nearest
 * the middle of the view (the interesting point — nearest the middle rather
 * than leftmost, so floor(x) or tan x opens where the class is looking); else
 * 0, when 0 is in view and f is defined near it; else the middle of the view,
 * rounded to a nice number. Null when f is not a function of x.
 */
export function defaultLimitA(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  window: [number, number],
): number | null {
  const src = limitSourceOf(curve, models)
  if (!src) return null
  const lo = Math.min(window[0], window[1])
  const hi = Math.max(window[0], window[1])
  const mid = Number.isFinite(lo) && Number.isFinite(hi) ? (lo + hi) / 2 : 0
  const pts = limitSnapPoints(curve, models, [lo, hi]).filter((p) => p.x >= lo && p.x <= hi)
  if (pts.length > 0) {
    let best = pts[0]
    for (const p of pts) if (Math.abs(p.x - mid) < Math.abs(best.x - mid)) best = p
    return best.exact ? best.exact.value : best.x
  }
  if (lo <= 0 && hi >= 0) {
    const h = 1e-2
    const near = [src.f(-h), src.f(h), src.f(0)].some((v) => Number.isFinite(v))
    if (near) return 0
  }
  const span = hi - lo
  const step = span >= 4 ? 1 : span >= 1 ? 0.5 : Math.pow(10, Math.floor(Math.log10(Math.max(span, 1e-9))) - 1)
  const nice = Math.round(mid / step) * step
  return Math.abs(nice) < 1e-12 ? 0 : Number(nice.toPrecision(12))
}

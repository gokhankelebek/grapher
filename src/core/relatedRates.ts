// ============================================================================
// src/core/relatedRates.ts — related rates (AP Calculus AB/BC Unit 4).
//
// Five textbook scenarios, each a small parametric model in time t:
//
//   ladder   a ladder of length L slides down a wall; its foot moves out at
//            dx/dt = c.   x² + y² = L²  ⇒  dy/dt = −(x/y)·dx/dt
//   cone     a cone-shaped tank, vertex down (top radius R, height H), fills
//            or drains at dV/dt.   V = (π/3)r²h, r/h = R/H
//            ⇒  dV/dt = πr²·dh/dt  ⇒  dh/dt = (dV/dt)/(πr²)
//   shadow   a person of height p walks away from a lamp post of height H at
//            dx/dt = v.   s/p = (x + s)/H  ⇒  (H − p)·ds/dt = p·dx/dt;
//            the tip of the shadow moves at d(x + s)/dt = H·v/(H − p)
//   ripple   an expanding circle, dr/dt given.   A = πr²  ⇒  dA/dt = 2πr·dr/dt
//   balloon  a sphere inflated at dV/dt.   V = (4/3)πr³
//            ⇒  dV/dt = 4πr²·dr/dt  ⇒  dr/dt = (dV/dt)/(4πr²)
//
// A scenario is its givens (editable), the quantities it can be asked about
// ("when x = 6"), the relation, its derivative with respect to t and the
// solved unknown rate — as text and TeX — and state(t): every quantity and
// rate at time t. The unknown rate is evaluated from the SOLVED formula, so
// the number on the card is the formula on the card.
//
// Pure: no DOM, no React.
// ============================================================================

import { exactForm } from './exact'

export type RRScenario = 'ladder' | 'cone' | 'shadow' | 'ripple' | 'balloon'

export const RR_SCENARIOS: readonly RRScenario[] = ['ladder', 'cone', 'shadow', 'ripple', 'balloon']

export interface RRParamDef {
  key: string
  /** The letter on the card and the board: "L", "dx/dt". */
  label: string
  /** What it is, in words, for the tooltip. */
  name: string
  unit: string
  value: number
  /** Allowed range (the loader clamps; the card refuses outside it). */
  min: number
  max: number
  /** May it be negative? (a rate: draining, walking toward). */
  signed?: boolean
}

export interface RRQuantityDef {
  key: string
  label: string
  unit: string
}

export interface Formula {
  text: string
  tex: string
}

/** Every quantity and rate at one instant. */
export interface RRState {
  t: number
  /** The quantities by key (x, y; h, r, V; …). */
  q: Record<string, number>
  /** The rates by key (dx, dy; dV, dh; …) — per unit time. */
  rates: Record<string, number>
  /** The unknown rate, from the solved formula. NaN when it has no value. */
  unknown: number
  /** A second answer some scenarios ask for (the shadow's tip speed). */
  extra: number | null
  /** False once the model has left its geometry (a ladder flat on the floor). */
  valid: boolean
}

export interface RRScenarioDef {
  id: RRScenario
  title: string
  /** One line of the problem as an AP stem states it. */
  stem: string
  lenUnit: string
  timeUnit: string
  params: RRParamDef[]
  /** What "when … = …" may ask about. */
  quantities: RRQuantityDef[]
  /** The unknown rate: label and unit. */
  unknown: { key: string; label: string; unit: string; tex: string }
  /** A second rate reported beside it, when the problem asks for one. */
  extra?: { label: string; unit: string; tex: string }
  relation: Formula
  /** The relation with the givens' numbers in it (L = 10: x² + y² = 100). */
  relationWith(p: Params): Formula
  derivative: Formula
  solved: Formula
  /** The solved formula with the instant's numbers substituted. */
  substituted(p: Params, s: RRState): Formula
  extraSolved?: Formula
  state(p: Params, t: number): RRState
  /** The time interval the model plays over. */
  tMax(p: Params): number
  /** The default "when" question. */
  defaultWhen: { q: string; v: number }
}

export type Params = Record<string, number>

const PI = Math.PI

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

const MINUS = '−'

/** A live number: one decimal for lengths on the board, more on the card. */
export function dec(v: number, places = 2): string {
  if (!Number.isFinite(v)) return '—'
  let t = v.toFixed(places)
  if (/^-0\.?0*$/.test(t)) t = t.slice(1)
  return t.replace(/^-/, MINUS)
}

/**
 * A rate as the answer states it: exact when it is (−3/2, 3/π, 20π), else
 * a decimal. `exact` is null when there is no exact form.
 */
export function rateForm(v: number): { exact: Formula | null; decimal: string } {
  const decimal = dec(v, 3)
  if (!Number.isFinite(v)) return { exact: null, decimal }
  const e = exactForm(v)
  if (e) return { exact: { text: e.text, tex: e.tex }, decimal }
  // k/π: 3/π, −1/(2π)
  const k = exactForm(v * PI)
  if (k && !k.text.includes('π') && !k.text.includes('√')) {
    const neg = k.value < 0
    const body = k.text.replace(MINUS, '')
    const slash = body.indexOf('/')
    const text = slash < 0 ? `${body}/π` : `${body.slice(0, slash)}/(${body.slice(slash + 1)}π)`
    const r = /^(\d+)(?:\/(\d+))?$/.exec(body)
    const tex = r ? `\\frac{${r[1]}}{${r[2] ?? ''}\\pi}` : `${k.tex}/\\pi`
    return { exact: { text: `${neg ? MINUS : ''}${text}`, tex: `${neg ? '-' : ''}${tex}` }, decimal }
  }
  return { exact: null, decimal }
}

// ---------------------------------------------------------------------------
// The five scenarios
// ---------------------------------------------------------------------------

const clampTo = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

const LADDER: RRScenarioDef = {
  id: 'ladder',
  title: 'Sliding ladder',
  stem: 'A ladder leans against a wall; its foot slides away from the wall.',
  lenUnit: 'ft',
  timeUnit: 's',
  params: [
    { key: 'L', label: 'L', name: 'the ladder’s length', unit: 'ft', value: 10, min: 1, max: 100 },
    { key: 'c', label: 'dx/dt', name: 'how fast the foot moves away from the wall', unit: 'ft/s', value: 2, min: -50, max: 50, signed: true },
    { key: 'x0', label: 'x₀', name: 'the foot’s distance from the wall at t = 0', unit: 'ft', value: 1, min: 0, max: 100 },
  ],
  quantities: [
    { key: 'x', label: 'x', unit: 'ft' },
    { key: 'y', label: 'y', unit: 'ft' },
  ],
  unknown: { key: 'dy', label: 'dy/dt', unit: 'ft/s', tex: '\\frac{dy}{dt}' },
  relation: { text: 'x² + y² = L²', tex: 'x^2 + y^2 = L^2' },
  relationWith: (p) => ({ text: `x² + y² = ${num(p.L * p.L)}`, tex: `x^2 + y^2 = ${num(p.L * p.L)}` }),
  derivative: {
    text: '2x·dx/dt + 2y·dy/dt = 0',
    tex: '2x\\,\\frac{dx}{dt} + 2y\\,\\frac{dy}{dt} = 0',
  },
  solved: { text: 'dy/dt = −(x/y)·dx/dt', tex: '\\frac{dy}{dt} = -\\frac{x}{y}\\,\\frac{dx}{dt}' },
  substituted: (p, s) => ({
    text: `dy/dt = −(${num(s.q.x)}/${num(s.q.y)})(${num(p.c)})`,
    tex: `\\frac{dy}{dt} = -\\frac{${num(s.q.x)}}{${num(s.q.y)}}\\left(${num(p.c)}\\right)`,
  }),
  state: (p, t) => {
    const x = p.x0 + p.c * t
    const y2 = p.L * p.L - x * x
    const valid = x >= 0 && y2 > 0
    const y = valid ? Math.sqrt(y2) : 0
    const dy = valid ? -(x / y) * p.c : Number.NaN
    return { t, q: { x, y }, rates: { dx: p.c, dy }, unknown: dy, extra: null, valid }
  },
  tMax: (p) => {
    if (p.c === 0) return 5
    const end = p.c > 0 ? 0.98 * p.L : 0
    const T = (end - p.x0) / p.c
    return T > 0 ? T : 5
  },
  defaultWhen: { q: 'x', v: 6 },
}

/** V of water at depth h in a cone of top radius R and height H. */
const coneV = (R: number, H: number, h: number): number => (PI / 3) * (R / H) * (R / H) * h * h * h
const coneH = (R: number, H: number, V: number): number => Math.cbrt((3 * V) / (PI * (R / H) * (R / H)))

const CONE: RRScenarioDef = {
  id: 'cone',
  title: 'Cone tank',
  stem: 'Water flows into (or out of) a conical tank, vertex down.',
  lenUnit: 'ft',
  timeUnit: 'min',
  params: [
    { key: 'R', label: 'R', name: 'the tank’s radius at the top', unit: 'ft', value: 2, min: 0.1, max: 100 },
    { key: 'H', label: 'H', name: 'the tank’s height', unit: 'ft', value: 4, min: 0.1, max: 100 },
    { key: 'k', label: 'dV/dt', name: 'the flow: positive fills, negative drains', unit: 'ft³/min', value: 3, min: -1000, max: 1000, signed: true },
    { key: 'h0', label: 'h₀', name: 'the water’s depth at t = 0', unit: 'ft', value: 0.5, min: 0, max: 100 },
  ],
  quantities: [
    { key: 'h', label: 'h', unit: 'ft' },
    { key: 'r', label: 'r', unit: 'ft' },
    { key: 'V', label: 'V', unit: 'ft³' },
  ],
  unknown: { key: 'dh', label: 'dh/dt', unit: 'ft/min', tex: '\\frac{dh}{dt}' },
  relation: { text: 'V = (π/3)r²h,  r/h = R/H', tex: 'V = \\tfrac{\\pi}{3}r^2h,\\quad \\frac{r}{h} = \\frac{R}{H}' },
  relationWith: (p) => {
    const k = (p.R / p.H) * (p.R / p.H) / 3
    const e = exactForm(k)
    const coef = e ? e.text : dec(k, 4)
    const coefTex = e ? e.tex : dec(k, 4)
    return {
      text: `r = ${num(p.R / p.H)}h,  V = ${coef}·πh³`,
      tex: `r = ${num(p.R / p.H)}h,\\quad V = ${coefTex}\\,\\pi h^3`,
    }
  },
  derivative: {
    text: 'dV/dt = π(R/H)²h²·dh/dt = πr²·dh/dt',
    tex: '\\frac{dV}{dt} = \\pi\\left(\\tfrac{R}{H}\\right)^2 h^2\\,\\frac{dh}{dt} = \\pi r^2\\,\\frac{dh}{dt}',
  },
  solved: { text: 'dh/dt = (dV/dt)/(πr²)', tex: '\\frac{dh}{dt} = \\frac{dV/dt}{\\pi r^2}' },
  substituted: (p, s) => ({
    text: `dh/dt = ${num(p.k)}/(π·${num(s.q.r)}²)`,
    tex: `\\frac{dh}{dt} = \\frac{${num(p.k)}}{\\pi\\left(${num(s.q.r)}\\right)^2}`,
  }),
  state: (p, t) => {
    const V0 = coneV(p.R, p.H, clampTo(p.h0, 0, p.H))
    const V = V0 + p.k * t
    const Vfull = coneV(p.R, p.H, p.H)
    const valid = V > 0 && V <= Vfull * (1 + 1e-9)
    const h = valid ? coneH(p.R, p.H, V) : V <= 0 ? 0 : p.H
    const r = (p.R / p.H) * h
    const dh = valid && r > 0 ? p.k / (PI * r * r) : Number.NaN
    return { t, q: { h, r, V: Math.max(0, Math.min(V, Vfull)) }, rates: { dV: p.k, dh, dr: (p.R / p.H) * dh }, unknown: dh, extra: null, valid }
  },
  tMax: (p) => {
    const Vfull = coneV(p.R, p.H, p.H)
    const V0 = coneV(p.R, p.H, clampTo(p.h0, 0, p.H))
    if (p.k > 0) {
      const T = (Vfull - V0) / p.k
      return T > 0 ? T : 5
    }
    if (p.k < 0) {
      // Drained to 3% of the height: dh/dt runs away as r → 0.
      const T = (V0 - coneV(p.R, p.H, 0.03 * p.H)) / -p.k
      return T > 0 ? T : 5
    }
    return 5
  },
  defaultWhen: { q: 'h', v: 2 },
}

const SHADOW: RRScenarioDef = {
  id: 'shadow',
  title: 'Shadow',
  stem: 'A person walks away from a lamp post; how fast does the shadow grow, and its tip move?',
  lenUnit: 'ft',
  timeUnit: 's',
  params: [
    { key: 'H', label: 'H', name: 'the lamp’s height', unit: 'ft', value: 15, min: 0.5, max: 200 },
    { key: 'p', label: 'p', name: 'the person’s height', unit: 'ft', value: 6, min: 0.1, max: 100 },
    { key: 'v', label: 'dx/dt', name: 'the walking speed, away from the post', unit: 'ft/s', value: 5, min: -50, max: 50, signed: true },
    { key: 'x0', label: 'x₀', name: 'the distance from the post at t = 0', unit: 'ft', value: 5, min: 0, max: 200 },
  ],
  quantities: [
    { key: 'x', label: 'x', unit: 'ft' },
    { key: 's', label: 's', unit: 'ft' },
  ],
  unknown: { key: 'ds', label: 'ds/dt', unit: 'ft/s', tex: '\\frac{ds}{dt}' },
  extra: { label: 'd(x + s)/dt', unit: 'ft/s', tex: '\\frac{d(x+s)}{dt}' },
  relation: { text: 's/p = (x + s)/H', tex: '\\frac{s}{p} = \\frac{x + s}{H}' },
  relationWith: (p) => ({
    text: `s/${num(p.p)} = (x + s)/${num(p.H)}`,
    tex: `\\frac{s}{${num(p.p)}} = \\frac{x + s}{${num(p.H)}}`,
  }),
  derivative: {
    text: 'H·ds/dt = p·(dx/dt + ds/dt)',
    tex: 'H\\,\\frac{ds}{dt} = p\\left(\\frac{dx}{dt} + \\frac{ds}{dt}\\right)',
  },
  solved: { text: 'ds/dt = p·(dx/dt)/(H − p)', tex: '\\frac{ds}{dt} = \\frac{p}{H - p}\\,\\frac{dx}{dt}' },
  extraSolved: { text: 'd(x + s)/dt = H·(dx/dt)/(H − p)', tex: '\\frac{d(x+s)}{dt} = \\frac{H}{H - p}\\,\\frac{dx}{dt}' },
  substituted: (p) => ({
    text: `ds/dt = ${num(p.p)}·${num(p.v)}/(${num(p.H)} − ${num(p.p)})`,
    tex: `\\frac{ds}{dt} = \\frac{${num(p.p)}\\cdot ${num(p.v)}}{${num(p.H)} - ${num(p.p)}}`,
  }),
  state: (p, t) => {
    const x = p.x0 + p.v * t
    const valid = p.H > p.p && x >= 0
    const s = valid ? (p.p * x) / (p.H - p.p) : Number.NaN
    const ds = valid ? (p.p * p.v) / (p.H - p.p) : Number.NaN
    const tip = valid ? (p.H * p.v) / (p.H - p.p) : Number.NaN
    return { t, q: { x, s, tip: x + s }, rates: { dx: p.v, ds, dtip: tip }, unknown: ds, extra: tip, valid }
  },
  tMax: (p) => {
    if (p.v > 0) return 20 / p.v
    if (p.v < 0) return Math.max(0.5, p.x0 / -p.v)
    return 5
  },
  defaultWhen: { q: 'x', v: 10 },
}

const RIPPLE: RRScenarioDef = {
  id: 'ripple',
  title: 'Ripple (circle)',
  stem: 'A stone dropped in a pond sends out a circular ripple.',
  lenUnit: 'cm',
  timeUnit: 's',
  params: [
    { key: 'c', label: 'dr/dt', name: 'how fast the radius grows', unit: 'cm/s', value: 2, min: -100, max: 100, signed: true },
    { key: 'r0', label: 'r₀', name: 'the radius at t = 0', unit: 'cm', value: 1, min: 0, max: 1000 },
  ],
  quantities: [
    { key: 'r', label: 'r', unit: 'cm' },
    { key: 'A', label: 'A', unit: 'cm²' },
  ],
  unknown: { key: 'dA', label: 'dA/dt', unit: 'cm²/s', tex: '\\frac{dA}{dt}' },
  relation: { text: 'A = πr²', tex: 'A = \\pi r^2' },
  relationWith: () => ({ text: 'A = πr²', tex: 'A = \\pi r^2' }),
  derivative: { text: 'dA/dt = 2πr·dr/dt', tex: '\\frac{dA}{dt} = 2\\pi r\\,\\frac{dr}{dt}' },
  solved: { text: 'dA/dt = 2πr·dr/dt', tex: '\\frac{dA}{dt} = 2\\pi r\\,\\frac{dr}{dt}' },
  substituted: (p, s) => ({
    text: `dA/dt = 2π(${num(s.q.r)})(${num(p.c)})`,
    tex: `\\frac{dA}{dt} = 2\\pi\\left(${num(s.q.r)}\\right)\\left(${num(p.c)}\\right)`,
  }),
  state: (p, t) => {
    const r = p.r0 + p.c * t
    const valid = r >= 0
    const dA = valid ? 2 * PI * r * p.c : Number.NaN
    return { t, q: { r: Math.max(0, r), A: PI * Math.max(0, r) ** 2 }, rates: { dr: p.c, dA }, unknown: dA, extra: null, valid }
  },
  tMax: (p) => {
    if (p.c > 0) return Math.max(1, (10 - p.r0) / p.c)
    if (p.c < 0) return Math.max(0.5, p.r0 / -p.c)
    return 5
  },
  defaultWhen: { q: 'r', v: 5 },
}

const sphereR = (V: number): number => Math.cbrt((3 * V) / (4 * PI))

const BALLOON: RRScenarioDef = {
  id: 'balloon',
  title: 'Balloon (sphere)',
  stem: 'Air is pumped into a spherical balloon.',
  lenUnit: 'cm',
  timeUnit: 's',
  params: [
    { key: 'k', label: 'dV/dt', name: 'the air pumped in per second (negative lets it out)', unit: 'cm³/s', value: 100, min: -100000, max: 100000, signed: true },
    { key: 'r0', label: 'r₀', name: 'the radius at t = 0', unit: 'cm', value: 1, min: 0, max: 1000 },
  ],
  quantities: [
    { key: 'r', label: 'r', unit: 'cm' },
    { key: 'V', label: 'V', unit: 'cm³' },
  ],
  unknown: { key: 'dr', label: 'dr/dt', unit: 'cm/s', tex: '\\frac{dr}{dt}' },
  relation: { text: 'V = (4/3)πr³', tex: 'V = \\tfrac{4}{3}\\pi r^3' },
  relationWith: () => ({ text: 'V = (4/3)πr³', tex: 'V = \\tfrac{4}{3}\\pi r^3' }),
  derivative: { text: 'dV/dt = 4πr²·dr/dt', tex: '\\frac{dV}{dt} = 4\\pi r^2\\,\\frac{dr}{dt}' },
  solved: { text: 'dr/dt = (dV/dt)/(4πr²)', tex: '\\frac{dr}{dt} = \\frac{dV/dt}{4\\pi r^2}' },
  substituted: (p, s) => ({
    text: `dr/dt = ${num(p.k)}/(4π·${num(s.q.r)}²)`,
    tex: `\\frac{dr}{dt} = \\frac{${num(p.k)}}{4\\pi\\left(${num(s.q.r)}\\right)^2}`,
  }),
  state: (p, t) => {
    const V = (4 / 3) * PI * p.r0 ** 3 + p.k * t
    const valid = V > 0
    const r = valid ? sphereR(V) : 0
    const dr = valid && r > 0 ? p.k / (4 * PI * r * r) : Number.NaN
    return { t, q: { r, V: Math.max(0, V) }, rates: { dV: p.k, dr }, unknown: dr, extra: null, valid }
  },
  tMax: (p) => {
    const V0 = (4 / 3) * PI * p.r0 ** 3
    if (p.k > 0) {
      const target = Math.max(10, 2 * p.r0)
      return Math.max(1, ((4 / 3) * PI * target ** 3 - V0) / p.k)
    }
    if (p.k < 0) return Math.max(0.5, (V0 - (4 / 3) * PI * (0.05 * p.r0) ** 3) / -p.k)
    return 5
  },
  defaultWhen: { q: 'r', v: 5 },
}

export const RR_DEFS: Record<RRScenario, RRScenarioDef> = {
  ladder: LADDER,
  cone: CONE,
  shadow: SHADOW,
  ripple: RIPPLE,
  balloon: BALLOON,
}

/** A number in a formula: as short as it is (6, 2.5, 0.333). */
function num(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const r = Math.round(v * 1000) / 1000
  const t = String(r)
  return t.replace(/^-/, '-')
}

/** The givens a fresh scenario starts with. */
export function defaultParams(s: RRScenario): Params {
  const out: Params = {}
  for (const d of RR_DEFS[s].params) out[d.key] = d.value
  return out
}

/** Givens from an untrusted record: known keys, finite, in range; anything else the default. */
export function cleanParams(s: RRScenario, raw: unknown): Params {
  const out = defaultParams(s)
  if (!raw || typeof raw !== 'object') return out
  const rec = raw as Record<string, unknown>
  for (const d of RR_DEFS[s].params) {
    const v = rec[d.key]
    if (typeof v === 'number' && Number.isFinite(v)) out[d.key] = clampTo(v, d.min, d.max)
  }
  return out
}

/** The model at time t (clamped into its interval). */
export function rrState(s: RRScenario, p: Params, t: number): RRState {
  const def = RR_DEFS[s]
  const T = def.tMax(p)
  return def.state(p, clampTo(Number.isFinite(t) ? t : 0, 0, T))
}

/**
 * "When x = 6": the t in [0, tMax] at which quantity `q` equals `v`, or an
 * error sentence. Every quantity here is monotone in t, so the first sign
 * change is THE instant; it is polished by bisection.
 */
export function solveWhen(
  s: RRScenario,
  p: Params,
  q: string,
  v: number,
): { ok: true; t: number } | { ok: false; error: string } {
  const def = RR_DEFS[s]
  const qd = def.quantities.find((d) => d.key === q)
  if (!qd) return { ok: false, error: 'that quantity is not in this problem' }
  if (!Number.isFinite(v)) return { ok: false, error: 'type a number' }
  const T = def.tMax(p)
  const at = (t: number): number => def.state(p, t).q[q] - v
  const n = 400
  let prevT = 0
  let prev = at(0)
  if (Math.abs(prev) <= 1e-12 * Math.max(1, Math.abs(v))) return { ok: true, t: 0 }
  for (let i = 1; i <= n; i++) {
    const t = (T * i) / n
    const cur = at(t)
    if (Number.isFinite(prev) && Number.isFinite(cur) && (cur === 0 || prev * cur < 0)) {
      let lo = prevT
      let hi = t
      let flo = prev
      for (let k = 0; k < 80; k++) {
        const mid = (lo + hi) / 2
        const fm = at(mid)
        if (fm === 0) {
          lo = hi = mid
          break
        }
        if (flo * fm < 0) hi = mid
        else {
          lo = mid
          flo = fm
        }
      }
      return { ok: true, t: (lo + hi) / 2 }
    }
    prev = cur
    prevT = t
  }
  const a = def.state(p, 0).q[q]
  const b = def.state(p, T).q[q]
  return {
    ok: false,
    error: `${qd.label} never equals ${dec(v, 3)} here — it runs from ${dec(Math.min(a, b), 2)} to ${dec(Math.max(a, b), 2)} ${qd.unit}`,
  }
}

/** The unknown rate against t, for the mini-graph: n + 1 samples over [0, tMax]. */
export function rateSeries(s: RRScenario, p: Params, n = 120): { t: number; v: number }[] {
  const def = RR_DEFS[s]
  const T = def.tMax(p)
  const out: { t: number; v: number }[] = []
  for (let i = 0; i <= n; i++) {
    const t = (T * i) / n
    const st = def.state(p, t)
    out.push({ t, v: st.valid ? st.unknown : Number.NaN })
  }
  return out
}

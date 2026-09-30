// ============================================================================
// src/core/signChart.ts — sign charts of f, f′ and f″, and the AP statements
// they justify (AP Calculus Unit 5; AP Precalculus 1.2–1.5).
//
//   signChart(curve, models, which, range, as?)   one row: the ordered
//        critical x's (zeros, points where the row is undefined — poles,
//        holes, domain ends, corners and cusps — and discontinuities), the
//        sign on every open interval between them, exact forms for the x's
//   conclusions(curve, models, range, opts?)       the AP sentences, each with
//        its justification: increasing / decreasing (and why), relative
//        extrema by the First Derivative Test, concavity and points of
//        inflection, the Second Derivative Test, and the absolute extrema on
//        a closed interval by the Candidates Test
//
// "THE GRAPH OF f′ IS SHOWN." `as` says what the curve on the board IS: f
// (the default), f′ or f″. The rows are always rows of the unseen f, so with
// as = 'f1' the f′ row is the shown graph's own sign row, the f″ row is its
// slope's, and there is no f row at all — nothing about f's values can be
// read off f′. With as = 'f2' only the f″ row (concavity) exists.
//
// SOURCES. Each row is a function read from the best source there is (via
// src/core/limits.ts → mvt.ts): f from the curve's own evaluator (exactly at
// nice x); f′ from a polynomial's coefficients, a typed line's Taylor jets,
// a library family's symbolic slope, and only then a difference quotient;
// f″ from the polynomial, the jets (2·c₂), the family's derivative curve's
// own symbolic slope, and only then Richardson on f′.
//
// WHERE A ROW CAN CHANGE SIGN. Only at its zeros and where it is undefined or
// discontinuous. The chart therefore cuts [lo, hi] at every place the shown
// function fails to be continuous (continuityOn: poles, holes, jumps, excluded
// points, stretches outside the domain), and, for a derivative row, where it
// fails to be differentiable (differentiabilityOn: corners, cusps, vertical
// tangents — f′ undefined while f is defined, the critical points AP counts
// alongside f′ = 0), and — for f″ — where f′ fails to be. Between cuts the row
// is scanned for sign changes (bisected; accepted as a ZERO only where |g|
// really vanishes, otherwise a pole or a jump of the row itself) and for
// touching zeros (golden section on |g|: (x + 2)² at −2 is a zero with no sign
// change — a critical point where f has no extremum).
//
// THE ENDS. The analysis window is finite; the chart is not. Past each end the
// row is sampled out to ±∞ (or to a restricted domain's end): when it keeps
// one sign the last interval runs to ±∞, and when it does not — sin x, whose
// signs change forever — the chart stops at the window and says so
// (`truncated`), rather than claiming "increasing on (3π/2, ∞)".
//
// Pure: no DOM, no React. Never throws (a row that cannot be read is null).
// ============================================================================

import type { FittedCurve, ModelSpec } from './types'
import type { ExactForm } from './exact'
import { exactForm, verifiedExact } from './exact'
import { limitSourceOf } from './limits'
import type { LimitSource } from './limits'
import { continuityOn, differentiabilityOn } from './mvt'
import type { MvtSource } from './mvt'
import { derivativeModel, tangentAt } from './calculus'

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

/** f, f′, f″ — which function a row is about, or what the shown graph is. */
export type ChartLevel = 'f' | 'f1' | 'f2'
export const CHART_LEVELS: readonly ChartLevel[] = ['f', 'f1', 'f2']
export const levelIndex = (l: ChartLevel): number => CHART_LEVELS.indexOf(l)

/** What the row does AT a critical x: 0, undefined, or defined but jumping. */
export type MarkAt = 'zero' | 'und' | 'jump'

/** Why x is on the chart. */
export type MarkWhy =
  | 'zero'
  | 'pole'
  | 'hole'
  | 'jump'
  | 'removable'
  | 'undefined'
  | 'domain'
  | 'corner'
  | 'cusp'
  | 'vertical'
  /** f′ is not differentiable here (f″ undefined), though f′ exists */
  | 'bend'

export interface ChartMark {
  x: number
  exact: ExactForm | null
  /** "−1", "√3/3", "π/2", "1.618" */
  text: string
  at: MarkAt
  why: MarkWhy
  /**
   * f itself is defined and continuous at x — so x can be a critical point or
   * a point of inflection. With as = 'f1' / 'f2' f is not on the board; it is
   * taken to be continuous wherever the shown graph is defined, and at its
   * holes and jumps (the AP reading: "f is continuous"), but not at a pole.
   */
  fOk: boolean
  /** An end of the chart's extent (a domain end), and which one. */
  end?: 'left' | 'right'
}

export interface ChartInterval {
  /** ±Infinity for a chart that runs off to ±∞. */
  from: number
  to: number
  /** The row's sign there; 0 where it is identically 0; null outside the domain. */
  sign: 1 | -1 | 0 | null
}

export interface SignChart {
  /** Which derivative of f this row describes. */
  which: ChartLevel
  /** What the shown graph is. */
  as: ChartLevel
  /** The extent: ±Infinity where the chart runs off to ±∞. */
  lo: number
  hi: number
  /** In increasing x. */
  marks: ChartMark[]
  /** In increasing x, covering [lo, hi], split at every mark. */
  intervals: ChartInterval[]
  /** The chart stops at the analysis window (left, right) — the signs change beyond it. */
  truncated: [boolean, boolean]
}

// ---------------------------------------------------------------------------
// The source
// ---------------------------------------------------------------------------

/** How a chart reads the SHOWN function and its first two derivatives. */
export interface ChartSource {
  /** g[0] the shown function, g[1] its derivative, g[2] its second derivative. */
  g: [(x: number) => number, (x: number) => number, (x: number) => number]
  /** The shown function as the theorems read it (continuity, smoothness, holes, poles). */
  base: MvtSource
  /** Its derivative as a function in its own right — where IT fails to be smooth, g[2] is undefined. */
  d1: MvtSource
  /** The drawn domain, or null for all of ℝ. */
  domain: [number, number] | null
  /** The shown function at x, exactly when the source can say so. */
  valueAt(x: number): number
}

function safe(fn: (x: number) => number, x: number): number {
  try {
    const v = fn(x)
    return typeof v === 'number' ? v : Number.NaN
  } catch {
    return Number.NaN
  }
}

/** p′ as ascending coefficients. */
function polyDeriv(c: readonly number[]): number[] {
  const out: number[] = []
  for (let k = 1; k < c.length; k++) out.push(k * c[k])
  return out.length > 0 ? out : [0]
}

function horner(c: readonly number[], x: number): number {
  let v = 0
  for (let k = c.length - 1; k >= 0; k--) v = v * x + c[k]
  return v
}

/** Richardson-extrapolated central difference of a function that may be numeric itself. */
function richardson(f: (x: number) => number, x: number): number {
  const h = 1e-3 * Math.max(1, Math.abs(x))
  const d = (s: number): number => (safe(f, x + s) - safe(f, x - s)) / (2 * s)
  const a = d(h)
  const b = d(h / 2)
  const v = (4 * b - a) / 3
  return Number.isFinite(v) ? v : Number.NaN
}

/**
 * The chart source for a board curve: null when it is not a function of x.
 * f′ is mvt.ts's (polynomial → jets → symbolic family slope → difference
 * quotient); f″ is found the same way one level down.
 */
export function chartSourceOf(curve: FittedCurve, models: Record<string, ModelSpec>): ChartSource | null {
  let src: LimitSource | null = null
  try {
    src = limitSourceOf(curve, models)
  } catch {
    src = null
  }
  if (!src) return null
  const spec = models[curve.modelId]
  const params = curve.params.slice()
  const domain = src.domain
  const inside = (x: number): boolean => !domain || (x >= domain[0] && x <= domain[1])
  const f = src.f
  const d1 = src.d
  const jets = spec?.taylor ? spec.taylor.bind(spec) : null

  // f″: the polynomial, the jets, the family's derivative curve, Richardson.
  let d2: (x: number) => number
  if (src.poly) {
    const c2 = polyDeriv(polyDeriv(src.poly))
    d2 = (x) => (inside(x) && Number.isFinite(f(x)) ? horner(c2, x) : Number.NaN)
  } else {
    let famSlope: ((x: number) => number) | null = null
    if (!jets) {
      try {
        const dm = derivativeModel(curve, models, '__signchart_d1')
        if (dm && dm.exact) {
          const dCurve: FittedCurve = { ...curve, modelId: dm.spec.id, params: dm.params.slice(), domain: dm.domain }
          const dModels = { ...models, [dm.spec.id]: dm.spec }
          famSlope = (x) => tangentAt(dCurve, dModels, x)?.m ?? Number.NaN
        }
      } catch {
        famSlope = null
      }
    }
    d2 = (x) => {
      if (!inside(x) || !Number.isFinite(f(x))) return Number.NaN
      if (jets) {
        try {
          const c = jets(params, x, 2)
          if (c && Number.isFinite(c[1]) && Number.isFinite(c[2])) return 2 * c[2]
        } catch {
          /* fall through */
        }
      }
      if (famSlope) {
        const v = safe(famSlope, x)
        if (Number.isFinite(v)) return v
      }
      if (!Number.isFinite(safe(d1, x))) return Number.NaN
      return richardson(d1, x)
    }
  }
  const d1src: MvtSource = {
    f: (x) => safe(d1, x),
    d: (x) => safe(d2, x),
    domain,
    poly: src.poly ? polyDeriv(src.poly) : null,
  }
  if (jets) {
    d1src.jetSlope = (x) => {
      if (!inside(x)) return null
      try {
        const c = jets(params, x, 2)
        return c && Number.isFinite(c[1]) && Number.isFinite(c[2]) ? 2 * c[2] : null
      } catch {
        return null
      }
    }
  }
  if (src.pieceEnds) d1src.pieceEnds = src.pieceEnds.slice()
  const base = src
  const valueAt = (x: number): number => {
    if (base.exactAt) {
      try {
        const e = base.exactAt(x)
        if (typeof e === 'number') return e
      } catch {
        /* fall through */
      }
    }
    return safe(f, x)
  }
  return { g: [(x) => safe(f, x), (x) => safe(d1, x), (x) => safe(d2, x)], base, d1: d1src, domain, valueAt }
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

const MINUS = '−'

/** Three places, trailing zeros dropped, a real minus sign. */
export function decimalText(v: number): string {
  if (v === Infinity) return '∞'
  if (v === -Infinity) return `${MINUS}∞`
  if (!Number.isFinite(v)) return '—'
  const mag = Math.abs(v)
  if (mag !== 0 && (mag >= 1e7 || mag < 5e-4)) return v.toExponential(2).replace('-', MINUS)
  const s = v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
  return (s === '-0' ? '0' : s).replace('-', MINUS)
}

/** A location: its closed form when it is one, else three places. */
export function xText(x: number, exact: ExactForm | null = null): string {
  if (x === Infinity) return '∞'
  if (x === -Infinity) return `${MINUS}∞`
  if (x === 0) return '0'
  if (exact) return exact.text
  const ex = exactForm(x)
  return ex ? ex.text : decimalText(x)
}

/** " = 2", " ≈ 0.368" — a value measured in double precision, honestly. */
export function valueTail(v: number): string {
  if (!Number.isFinite(v)) return ' is undefined'
  if (v === 0) return ' = 0'
  const ex = exactForm(v)
  if (ex) return ` = ${ex.text}`
  const t = Math.round(v * 1000) / 1000
  if (Math.abs(t - v) <= 1e-12 * Math.max(1, Math.abs(v))) return ` = ${decimalText(v)}`
  return ` ≈ ${decimalText(v)}`
}

const scaleOf = (x: number): number => Math.max(1, Math.abs(x))

/** Snap a location onto a closed form when the row itself agrees. */
function snapZero(x: number, check: (c: number) => boolean): { x: number; exact: ExactForm | null } {
  if (Math.abs(x) < 1e-9 && check(0)) return { x: 0, exact: { text: '0', tex: '0', value: 0 } }
  let ex: ExactForm | null = null
  try {
    ex = verifiedExact(x, check)
  } catch {
    ex = null
  }
  return ex ? { x: ex.value + 0, exact: ex } : { x, exact: null }
}

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** Samples across the whole chart for the zero scans (shared among segments by length). */
const SCAN_N = 1600
/** At least this many samples in any one segment. */
const SEG_MIN = 48
/** Samples for the tail check out to ±∞. */
const TAIL_N = 320
/** A bisected sign change is a ZERO when |g| there is below this fraction of its neighbours'. */
const ZERO_REL = 1e-6
/** A touching zero: |g| at the minimum below this fraction of its neighbours'. */
const TOUCH_REL = 1e-6
/** A sign change whose ends blow up this far past the neighbours' size is a pole of the row. */
const POLE_REL = 1e6

// ---------------------------------------------------------------------------
// One row
// ---------------------------------------------------------------------------

interface Cut {
  x: number
  exact: ExactForm | null
  why: MarkWhy
  /** the shown function is discontinuous here: every derivative row is undefined */
  level: 0 | 1 | 2
}

const MEMO = new WeakMap<ChartSource, Map<string, SignChart | null>>()

/**
 * One row of the chart from a source (tests hand it one built by hand).
 * Null when the row does not exist for `as` (the f row of a shown f′), or the
 * range is empty.
 */
export function signChartOf(
  src: ChartSource,
  which: ChartLevel,
  range: readonly [number, number],
  as: ChartLevel = 'f',
): SignChart | null {
  const key = `${which}|${as}|${range[0]}|${range[1]}`
  let memo = MEMO.get(src)
  if (!memo) {
    memo = new Map()
    MEMO.set(src, memo)
  }
  if (memo.has(key)) return memo.get(key) ?? null
  let out: SignChart | null = null
  try {
    out = buildChart(src, which, range, as)
  } catch {
    out = null
  }
  memo.set(key, out)
  return out
}

/** One row of the chart for a board curve (see the header). */
export function signChart(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  which: ChartLevel,
  range: readonly [number, number],
  as: ChartLevel = 'f',
): SignChart | null {
  const src = chartSourceOf(curve, models)
  return src ? signChartOf(src, which, range, as) : null
}

function buildChart(src: ChartSource, which: ChartLevel, range: readonly [number, number], as: ChartLevel): SignChart | null {
  const k = levelIndex(which) - levelIndex(as)
  if (k < 0 || k > 2) return null
  const g = src.g[k as 0 | 1 | 2]
  let lo = Math.min(range[0], range[1])
  let hi = Math.max(range[0], range[1])
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null
  const dom = src.domain
  let domLo = false
  let domHi = false
  if (dom) {
    if (dom[0] >= lo) {
      lo = dom[0]
      domLo = true
    }
    if (dom[1] <= hi) {
      hi = dom[1]
      domHi = true
    }
  }
  if (!(hi > lo)) return null
  const span = hi - lo
  const shownIsF = as === 'f'

  // ---- the cuts: where the shown function breaks, and where its derivatives do
  const cuts: Cut[] = []
  const stretches: [number, number][] = []
  const addCut = (c: Cut): void => {
    if (!Number.isFinite(c.x) || c.x < lo - 1e-12 * scaleOf(lo) || c.x > hi + 1e-12 * scaleOf(hi)) return
    const tol = 1e-9 * Math.max(span, scaleOf(c.x))
    const same = cuts.find((o) => Math.abs(o.x - c.x) <= tol)
    if (same) {
      // the lower level wins: a pole of f is a pole, whatever f′ does there
      if (c.level < same.level) Object.assign(same, c)
      return
    }
    cuts.push({ ...c, x: Math.min(hi, Math.max(lo, c.x)) })
  }
  let cont: ReturnType<typeof continuityOn> = []
  try {
    cont = continuityOn(src.base, lo, hi)
  } catch {
    cont = []
  }
  for (const c of cont) {
    if (c.kind === 'undefined' && c.to !== undefined && c.to > c.x) {
      stretches.push([c.x, c.to])
      continue
    }
    if (c.kind === 'domain') continue
    addCut({ x: c.x, exact: c.exact, why: c.kind, level: 0 })
  }
  if (k >= 1) {
    let sm: ReturnType<typeof differentiabilityOn> = []
    try {
      sm = differentiabilityOn(src.base, lo, hi)
    } catch {
      sm = []
    }
    for (const s of sm) addCut({ x: s.x, exact: s.exact, why: s.kind, level: 1 })
  }
  if (k === 2) {
    let sm: ReturnType<typeof differentiabilityOn> = []
    try {
      sm = differentiabilityOn(src.d1, lo, hi)
    } catch {
      sm = []
    }
    for (const s of sm) addCut({ x: s.x, exact: s.exact, why: 'bend', level: 2 })
  }
  stretches.sort((p, q) => p[0] - q[0])
  const inStretch = (x: number): boolean => stretches.some(([p, q]) => x > p && x < q)

  // ---- the row's own scale, for "is this 0?"
  const probe: number[] = []
  for (let i = 0; i <= 400; i++) {
    const v = Math.abs(g(lo + (span * (i + 0.5)) / 401))
    if (Number.isFinite(v)) probe.push(v)
  }
  probe.sort((p, q) => p - q)
  const scale = probe.length > 0 ? Math.max(probe[Math.floor(0.75 * (probe.length - 1))], 1e-300) : 1
  const flat = 1e-12 * scale

  // ---- the segments between cuts, scanned for zeros and for breaks of the row itself
  const found: { x: number; exact: ExactForm | null; at: MarkAt; why: MarkWhy }[] = []
  const boundaries = [lo, hi, ...cuts.map((c) => c.x)]
  for (const [p, q] of stretches) boundaries.push(p, q)
  const bs = [...new Set(boundaries)].sort((p, q) => p - q)
  for (let s = 0; s + 1 < bs.length; s++) {
    const u = bs[s]
    const v = bs[s + 1]
    if (!(v > u)) continue
    const mid = 0.5 * (u + v)
    if (inStretch(mid)) continue
    scanSegment(g, u, v, Math.max(SEG_MIN, Math.round((SCAN_N * (v - u)) / span)), flat, found)
  }

  // ---- the marks
  const marks: ChartMark[] = []
  const fAt = (x: number): { defined: boolean; ok: boolean } => {
    const v = src.valueAt(x)
    return { defined: Number.isFinite(v), ok: Number.isFinite(v) }
  }
  // A cut of level L says the shown function's L-th derivative... breaks: for
  // L = 0 the shown function itself is discontinuous (so every derivative row
  // is undefined there, and its own row reads its value); for L ≥ 1 the
  // (L−1)-th derivative is not differentiable, so rows L, L+1 … are undefined
  // there. A row BELOW the cut's level passes straight through it — a corner
  // of f is no mark on the f row, unless f happens to be 0 there (|x| at 0).
  for (const c of cuts) {
    let at: MarkAt
    let why: MarkWhy = c.why
    if (c.level > k) {
      const v = k === 0 ? src.valueAt(c.x) : g(c.x)
      if (!(Number.isFinite(v) && Math.abs(v) <= 1e-9 * scale)) continue
      at = 'zero'
      why = 'zero'
    } else if (c.level === 0 && k === 0) {
      const v = src.valueAt(c.x)
      at = !Number.isFinite(v) ? 'und' : Math.abs(v) <= 1e-9 * scale ? 'zero' : 'jump'
    } else {
      at = 'und'
    }
    const fa = fAt(c.x)
    const discontinuousF = c.level === 0 // continuityOn: f itself breaks here
    const fOk = shownIsF ? fa.ok && !discontinuousF : c.why !== 'pole' && c.why !== 'undefined'
    marks.push({ x: c.x, exact: c.exact, text: xText(c.x, c.exact), at, why, fOk })
  }
  for (const z of found) {
    const tol = 1e-9 * Math.max(span, scaleOf(z.x))
    if (marks.some((m) => Math.abs(m.x - z.x) <= tol)) continue
    const fa = fAt(z.x)
    const fOk = shownIsF ? fa.ok : z.why !== 'pole'
    marks.push({ x: z.x, exact: z.exact, text: xText(z.x, z.exact), at: z.at, why: z.why, fOk })
  }
  // The domain's ends inside [lo, hi]: a restricted domain's, and the edges of
  // every stretch where f is undefined.
  const endMark = (x: number, side: 'left' | 'right'): void => {
    const tol = 1e-9 * Math.max(span, scaleOf(x))
    const have = marks.find((m) => Math.abs(m.x - x) <= tol)
    const v = k === 0 ? src.valueAt(x) : g(x)
    const at: MarkAt = !Number.isFinite(v) ? 'und' : Math.abs(v) <= 1e-9 * scale ? 'zero' : 'jump'
    const fv = src.valueAt(x)
    if (have) {
      have.end = side
      return
    }
    const exact = x === 0 ? { text: '0', tex: '0', value: 0 } : exactForm(x, { tol: 1e-9 })
    marks.push({
      x: exact ? exact.value + 0 : x,
      exact,
      text: xText(x, exact),
      at,
      why: 'domain',
      fOk: shownIsF ? Number.isFinite(fv) : true,
      end: side,
    })
  }
  if (domLo) endMark(lo, 'left')
  if (domHi) endMark(hi, 'right')
  for (const [p, q] of stretches) {
    if (p > lo + 1e-12 * span) endMark(p, 'right')
    if (q < hi - 1e-12 * span) endMark(q, 'left')
  }
  marks.sort((p, q) => p.x - q.x)

  // ---- the ends: out to ±∞ (or the domain's end) when the row keeps its sign
  let extLo = lo
  let extHi = hi
  const truncated: [boolean, boolean] = [false, false]
  const edgeUndefinedLo = stretches.some(([p]) => p <= lo + 1e-12 * span)
  const edgeUndefinedHi = stretches.some(([, q]) => q >= hi - 1e-12 * span)
  const firstDefined = (): number => {
    const m = marks.find((mm) => mm.x > lo)
    return m ? m.x : hi
  }
  const lastDefined = (): number => {
    const ms = marks.filter((mm) => mm.x < hi)
    return ms.length > 0 ? ms[ms.length - 1].x : lo
  }
  if (!domLo) {
    const limit = dom ? dom[0] : -Infinity
    const edgeSign = edgeUndefinedLo ? null : signOn(g, lo, Math.min(firstDefined(), lo + 0.25 * span), flat)
    const t = tail(src.g[0], g, lo, -1, limit, span, edgeSign, flat)
    if (t === 'clean') {
      extLo = limit
      if (dom) {
        // A restricted domain beyond the window: its end is a mark too.
        const v = k === 0 ? src.valueAt(limit) : g(limit)
        const ex = exactForm(limit, { tol: 1e-9 })
        marks.unshift({
          x: limit,
          exact: ex,
          text: xText(limit, ex),
          at: !Number.isFinite(v) ? 'und' : Math.abs(v) <= 1e-9 * scale ? 'zero' : 'jump',
          why: 'domain',
          fOk: shownIsF ? Number.isFinite(src.valueAt(limit)) : true,
          end: 'left',
        })
      }
    } else {
      truncated[0] = true
    }
  }
  if (!domHi) {
    const limit = dom ? dom[1] : Infinity
    const edgeSign = edgeUndefinedHi ? null : signOn(g, Math.max(lastDefined(), hi - 0.25 * span), hi, flat)
    const t = tail(src.g[0], g, hi, 1, limit, span, edgeSign, flat)
    if (t === 'clean') {
      extHi = limit
      if (dom) {
        const v = k === 0 ? src.valueAt(limit) : g(limit)
        const ex = exactForm(limit, { tol: 1e-9 })
        marks.push({
          x: limit,
          exact: ex,
          text: xText(limit, ex),
          at: !Number.isFinite(v) ? 'und' : Math.abs(v) <= 1e-9 * scale ? 'zero' : 'jump',
          why: 'domain',
          fOk: shownIsF ? Number.isFinite(src.valueAt(limit)) : true,
          end: 'right',
        })
      }
    } else {
      truncated[1] = true
    }
  }

  // ---- the intervals
  const xs = [extLo, ...marks.map((m) => m.x).filter((x) => x > extLo && x < extHi), extHi]
  const intervals: ChartInterval[] = []
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i]
    const b = xs[i + 1]
    if (!(b > a)) continue
    // Sample the finite part of the interval: past the window, the tail check
    // has already said the sign does not change.
    const fa = Number.isFinite(a) ? a : Math.min(b, lo) - Math.max(1, 0.25 * span)
    const fb = Number.isFinite(b) ? b : Math.max(a, hi) + Math.max(1, 0.25 * span)
    const ma = Math.max(fa, lo)
    const mb = Math.min(fb, hi)
    const inside = mb > ma ? [ma, mb] : [fa, fb]
    const midX = 0.5 * (inside[0] + inside[1])
    const sign = inStretch(midX) || (Number.isFinite(a) && Number.isFinite(b) && inStretch(0.5 * (a + b)))
      ? null
      : signOn(g, inside[0], inside[1], flat)
    intervals.push({ from: a, to: b, sign })
  }
  // An undefined stretch that runs off the window, with f undefined all the
  // way to ±∞, is outside the domain on that side: the chart starts at its edge.
  return { which, as, lo: extLo, hi: extHi, marks, intervals, truncated }
}

/** The sign of g on (a, b), read from interior samples: the majority, 0 when g vanishes there, null when undefined. */
function signOn(g: (x: number) => number, a: number, b: number, flat: number): 1 | -1 | 0 | null {
  if (!(b > a)) return null
  let pos = 0
  let neg = 0
  let zero = 0
  const n = 11
  for (let i = 1; i <= n; i++) {
    const x = a + ((b - a) * i) / (n + 1)
    const v = g(x)
    if (Number.isNaN(v)) continue
    if (Math.abs(v) <= flat) zero++
    else if (v > 0) pos++
    else neg++
  }
  if (pos + neg + zero === 0) return null
  if (pos === 0 && neg === 0) return 0
  return pos >= neg ? 1 : -1
}

/**
 * Past the window's edge x0 (dir −1: to the left), out to `limit` (±∞ or a
 * restricted domain's end): does the row keep the sign it has at the edge,
 * with f defined all the way? 'clean' then; 'dirty' otherwise.
 */
function tail(
  f: (x: number) => number,
  g: (x: number) => number,
  x0: number,
  dir: -1 | 1,
  limit: number,
  span: number,
  edgeSign: 1 | -1 | 0 | null,
  flat: number,
): 'clean' | 'dirty' {
  const finiteLimit = Number.isFinite(limit)
  if (finiteLimit && Math.abs(limit - x0) <= 1e-12 * scaleOf(x0)) return 'clean'
  const s = Math.max(1, span / 4)
  let pos = 0
  let neg = 0
  let undef = 0
  let defined = 0
  let zero = 0
  for (let j = 1; j <= TAIL_N; j++) {
    let x: number
    if (finiteLimit) {
      x = x0 + ((limit - x0) * j) / TAIL_N
    } else {
      const t = (0.995 * j) / TAIL_N
      x = x0 + (dir * s * t) / (1 - t)
    }
    const fv = f(x)
    // Past where f overflows, doubles say nothing more (x·e^(−x) far left is
    // −∞, and its jets are ∞·0 there): what was seen up to here stands.
    if (!Number.isNaN(fv) && !(Math.abs(fv) <= 1e250)) break
    const v = g(x)
    // Overflow keeps its sign (e^(−x) far left is +∞, not undefined).
    if (Number.isNaN(fv) || Number.isNaN(v)) {
      undef++
      continue
    }
    defined++
    if (v === 0 || Math.abs(v) <= flat * 1e-3) zero++
    else if (v > 0) pos++
    else neg++
  }
  if (edgeSign === null) {
    // Undefined at the edge: clean only when it stays undefined all the way.
    return defined === 0 ? 'clean' : 'dirty'
  }
  if (undef > 0) return 'dirty'
  if (edgeSign === 0) return pos === 0 && neg === 0 ? 'clean' : 'dirty'
  // Exact zeros far out are underflow (x·e^(−x) at x = 2000), not a sign.
  if (edgeSign > 0) return neg === 0 && pos > 0 ? 'clean' : pos === 0 && neg === 0 && zero > 0 ? 'clean' : 'dirty'
  return pos === 0 && neg > 0 ? 'clean' : pos === 0 && neg === 0 && zero > 0 ? 'clean' : 'dirty'
}

/**
 * Zeros of g inside (u, v) — sign changes and touches — and the places where
 * g itself breaks (a sign change across a pole or a jump of the row that no
 * cut predicted).
 */
function scanSegment(
  g: (x: number) => number,
  u: number,
  v: number,
  n: number,
  flat: number,
  out: { x: number; exact: ExactForm | null; at: MarkAt; why: MarkWhy }[],
): void {
  const w = v - u
  const inset = 1e-7 * w
  const xs: number[] = []
  const gs: number[] = []
  for (let i = 0; i <= n; i++) {
    const x = i === 0 ? u + inset : i === n ? v - inset : u + (w * i) / n
    xs.push(x)
    gs.push(g(x))
  }
  const mag = (i: number): number => {
    let m = 0
    for (let j = Math.max(0, i - 2); j <= Math.min(n, i + 3); j++) {
      const a = Math.abs(gs[j])
      if (Number.isFinite(a) && a > m) m = a
    }
    return m
  }
  const push = (x: number, at: MarkAt, why: MarkWhy, check: ((c: number) => boolean) | null): void => {
    if (!(x > u && x < v)) return
    if (out.some((o) => Math.abs(o.x - x) <= 1e-9 * Math.max(w, scaleOf(x)))) return
    if (check) {
      const s = snapZero(x, check)
      if (s.x > u && s.x < v) {
        out.push({ x: s.x, exact: s.exact, at, why })
        return
      }
    }
    const ex = exactForm(x, { tol: 1e-10 })
    out.push({ x: ex ? ex.value + 0 : x, exact: ex, at, why })
  }

  // Exactly zero at a sample, between two samples that are not (a run of
  // exact zeros is a stretch where g ≡ 0, and its ends are found below).
  for (let i = 1; i < n; i++) {
    if (gs[i] !== 0) continue
    if (gs[i - 1] === 0 && gs[i + 1] === 0) continue
    const nb = Math.max(Math.abs(gs[i - 1]), Math.abs(gs[i + 1]))
    if (!Number.isFinite(nb)) continue
    if (gs[i - 1] === 0 || gs[i + 1] === 0) {
      // the end of a zero stretch: a mark where g starts (or stops) vanishing
      push(xs[i], 'zero', 'zero', null)
      continue
    }
    push(xs[i], 'zero', 'zero', (c) => Math.abs(g(c)) <= 1e-9 * nb)
  }

  // Sign changes.
  for (let i = 0; i < n; i++) {
    const p = gs[i]
    const q = gs[i + 1]
    if (Number.isNaN(p) || Number.isNaN(q) || p === 0 || q === 0) continue
    if (Math.sign(p) === Math.sign(q)) continue
    let l = xs[i]
    let r = xs[i + 1]
    const sl = Math.sign(p)
    let hitNaN = false
    for (let it = 0; it < 200; it++) {
      const m = 0.5 * (l + r)
      if (m === l || m === r) break
      const gm = g(m)
      if (Number.isNaN(gm)) {
        hitNaN = true
        l = m
        r = m
        break
      }
      if (gm === 0) {
        l = m
        r = m
        break
      }
      if (Math.sign(gm) === sl) l = m
      else r = m
    }
    const gl = Math.abs(g(l))
    const gr = Math.abs(g(r))
    const x = gl <= gr ? l : r
    const nb = mag(i)
    if (!hitNaN && Math.min(gl, gr) <= ZERO_REL * nb + flat) {
      push(x, 'zero', 'zero', (c) => Math.abs(g(c)) <= 1e-9 * nb + flat)
    } else if (hitNaN || !Number.isFinite(gl) || !Number.isFinite(gr) || Math.max(gl, gr) > POLE_REL * Math.max(nb, 1e-300)) {
      push(0.5 * (l + r), 'und', 'pole', null)
    } else {
      push(0.5 * (l + r), 'jump', 'jump', null)
    }
  }

  // Touching zeros: a local minimum of |g| that (nearly) reaches 0.
  for (let i = 1; i < n; i++) {
    const a = Math.abs(gs[i - 1])
    const b = Math.abs(gs[i])
    const c = Math.abs(gs[i + 1])
    if (![a, b, c].every(Number.isFinite) || b === 0) continue
    if (!(b <= a && b <= c)) continue
    if (Math.sign(gs[i - 1]) !== Math.sign(gs[i + 1]) || Math.sign(gs[i]) !== Math.sign(gs[i + 1])) continue
    const nb = Math.max(a, c)
    if (b > 0.5 * nb) continue
    let l = xs[i - 1]
    let r = xs[i + 1]
    const phi = (Math.sqrt(5) - 1) / 2
    for (let it = 0; it < 160; it++) {
      const m1 = r - phi * (r - l)
      const m2 = l + phi * (r - l)
      if (!(m2 > m1)) break
      if (Math.abs(g(m1)) <= Math.abs(g(m2))) r = m2
      else l = m1
    }
    const m = 0.5 * (l + r)
    const gm = Math.abs(g(m))
    if (!(gm <= TOUCH_REL * nb + flat)) continue
    push(m, 'zero', 'zero', (cc) => Math.abs(g(cc)) <= 1e-9 * nb + flat)
  }

  // Undefined samples inside the segment that no cut predicted: a point of
  // the row's own (an excluded x of f′), or the edges of a run.
  for (let i = 1; i < n; i++) {
    if (!Number.isNaN(gs[i])) continue
    if (Number.isNaN(gs[i - 1]) && Number.isNaN(gs[i + 1])) continue
    push(xs[i], 'und', 'undefined', null)
  }
}

// ---------------------------------------------------------------------------
// The AP statements
// ---------------------------------------------------------------------------

export type ConclusionKind =
  | 'increasing'
  | 'decreasing'
  | 'constant'
  | 'relmax'
  | 'relmin'
  | 'noext'
  | 'notcritical'
  | 'sdt'
  | 'concaveUp'
  | 'concaveDown'
  | 'straight'
  | 'inflection'
  | 'noinflection'
  | 'candidates'
  | 'absmax'
  | 'absmin'
  | 'nocandidates'
  | 'window'

export interface Conclusion {
  kind: ConclusionKind
  /** The whole AP sentence, justification included. */
  text: string
  /** The x's it is about (extrema, inflections, candidates). */
  xs?: number[]
}

export interface ConclusionOpts {
  /** What the shown graph is. Absent: f. */
  as?: ChartLevel
  /** [a, b] for the Candidates Test. Absent: a closed restricted domain, when there is one. */
  interval?: readonly [number, number] | null
  /** The function's letter. Absent: f. */
  fName?: string
}

/** "(−∞, −1)" */
function intervalText(iv: ChartInterval, marks: readonly ChartMark[]): string {
  const t = (x: number): string => {
    if (!Number.isFinite(x)) return xText(x)
    const m = marks.find((mm) => mm.x === x)
    return m ? m.text : xText(x)
  }
  return `(${t(iv.from)}, ${t(iv.to)})`
}

/** "A", "A and B", "A, B, and C" */
export function listText(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

/** The signs just left and right of a mark, from its chart. */
function sidesOf(chart: SignChart, x: number): [1 | -1 | 0 | null, 1 | -1 | 0 | null] {
  const left = chart.intervals.find((iv) => iv.to === x)
  const right = chart.intervals.find((iv) => iv.from === x)
  return [left ? left.sign : null, right ? right.sign : null]
}

const signWord = (s: 1 | -1 | 0 | null): string => (s === 1 ? 'positive' : s === -1 ? 'negative' : 'zero')

/** The statements from a source (see `conclusions`). */
export function conclusionsOf(
  src: ChartSource,
  range: readonly [number, number],
  opts: ConclusionOpts = {},
): Conclusion[] {
  const as = opts.as ?? 'f'
  const F = opts.fName ?? 'f'
  const P1 = `${F}′`
  const P2 = `${F}″`
  const out: Conclusion[] = []
  const c1 = as === 'f2' ? null : signChartOf(src, 'f1', range, as)
  const c2 = signChartOf(src, 'f2', range, as)

  // ---- increasing / decreasing, and the First Derivative Test
  if (c1) {
    const inc = c1.intervals.filter((iv) => iv.sign === 1)
    const dec = c1.intervals.filter((iv) => iv.sign === -1)
    const flat = c1.intervals.filter((iv) => iv.sign === 0)
    if (inc.length > 0) {
      out.push({
        kind: 'increasing',
        text: `${F} is increasing on ${listText(inc.map((iv) => intervalText(iv, c1.marks)))} because ${P1}(x) > 0 there.`,
      })
    }
    if (dec.length > 0) {
      out.push({
        kind: 'decreasing',
        text: `${F} is decreasing on ${listText(dec.map((iv) => intervalText(iv, c1.marks)))} because ${P1}(x) < 0 there.`,
      })
    }
    if (flat.length > 0) {
      out.push({
        kind: 'constant',
        text: `${F} is constant on ${listText(flat.map((iv) => intervalText(iv, c1.marks)))} because ${P1}(x) = 0 there.`,
      })
    }
    for (const m of c1.marks) {
      if (m.end) continue
      const at = `x = ${m.text}`
      if (!m.fOk) {
        if (as === 'f' && m.at === 'und' && (m.why === 'pole' || m.why === 'hole' || m.why === 'undefined')) {
          out.push({
            kind: 'notcritical',
            text: `x = ${m.text} is not a critical point: ${F} is not defined there.`,
            xs: [m.x],
          })
        }
        continue
      }
      if (m.at === 'jump') continue
      const [l, r] = sidesOf(c1, m.x)
      if (l === null || r === null) continue
      if (l === 1 && r === -1) {
        out.push({
          kind: 'relmax',
          text: `${F} has a relative maximum at ${at} because ${P1} changes from positive to negative there.`,
          xs: [m.x],
        })
      } else if (l === -1 && r === 1) {
        out.push({
          kind: 'relmin',
          text: `${F} has a relative minimum at ${at} because ${P1} changes from negative to positive there.`,
          xs: [m.x],
        })
      } else if (l === r && l !== 0) {
        out.push({
          kind: 'noext',
          text: `${F} has no relative extremum at ${at} because ${P1} does not change sign there (it is ${signWord(l)} on both sides).`,
          xs: [m.x],
        })
      }
    }
    // The Second Derivative Test at every x where f′ = 0.
    for (const m of c1.marks) {
      if (m.end || !m.fOk || m.at !== 'zero') continue
      const k2 = levelIndex('f2') - levelIndex(as)
      const v = src.g[k2 as 1 | 2](m.x)
      const at = m.text
      if (!Number.isFinite(v)) {
        out.push({
          kind: 'sdt',
          text: `${P2}(${at}) does not exist, so the Second Derivative Test does not apply at x = ${at}.`,
          xs: [m.x],
        })
        continue
      }
      const scale = Math.max(1, Math.abs(src.g[k2 as 1 | 2](m.x + 1)), Math.abs(src.g[k2 as 1 | 2](m.x - 1)))
      if (Math.abs(v) <= 1e-8 * scale) {
        out.push({
          kind: 'sdt',
          text: `${P1}(${at}) = 0 and ${P2}(${at}) = 0, so the Second Derivative Test is inconclusive at x = ${at}.`,
          xs: [m.x],
        })
        continue
      }
      const tailT = valueTail(v)
      const cmp = v > 0 ? ' > 0' : ' < 0'
      out.push({
        kind: 'sdt',
        text: `${P1}(${at}) = 0 and ${P2}(${at})${tailT}${cmp}, so ${F} has a relative ${v > 0 ? 'minimum' : 'maximum'} at x = ${at} by the Second Derivative Test.`,
        xs: [m.x],
      })
    }
  }

  // ---- concavity and points of inflection
  if (c2) {
    const byF1 = as === 'f1'
    const up = c2.intervals.filter((iv) => iv.sign === 1)
    const down = c2.intervals.filter((iv) => iv.sign === -1)
    const why = (s: 1 | -1): string =>
      byF1 ? `${P1} is ${s > 0 ? 'increasing' : 'decreasing'} there` : `${P2}(x) ${s > 0 ? '>' : '<'} 0 there`
    if (up.length > 0) {
      out.push({
        kind: 'concaveUp',
        text: `The graph of ${F} is concave up on ${listText(up.map((iv) => intervalText(iv, c2.marks)))} because ${why(1)}.`,
      })
    }
    if (down.length > 0) {
      out.push({
        kind: 'concaveDown',
        text: `The graph of ${F} is concave down on ${listText(down.map((iv) => intervalText(iv, c2.marks)))} because ${why(-1)}.`,
      })
    }
    const straight = c2.intervals.filter((iv) => iv.sign === 0)
    if (straight.length > 0) {
      out.push({
        kind: 'straight',
        text: `The graph of ${F} is a line (neither concave up nor concave down) on ${listText(
          straight.map((iv) => intervalText(iv, c2.marks)),
        )} because ${byF1 ? `${P1} is constant there` : `${P2}(x) = 0 there`}.`,
      })
    }
    for (const m of c2.marks) {
      if (m.end || !m.fOk || m.at === 'jump') continue
      const [l, r] = sidesOf(c2, m.x)
      if (l === null || r === null) continue
      const at = `x = ${m.text}`
      if ((l === 1 && r === -1) || (l === -1 && r === 1)) {
        const change = byF1
          ? `${P1} changes from ${l === 1 ? 'increasing to decreasing' : 'decreasing to increasing'} there`
          : `${P2} changes from ${signWord(l)} to ${signWord(r)} there`
        out.push({
          kind: 'inflection',
          text: `The graph of ${F} has a point of inflection at ${at} because ${change}.`,
          xs: [m.x],
        })
      } else if (l === r && l !== 0 && m.at === 'zero') {
        const why2 = byF1
          ? `${P1} is ${l === 1 ? 'increasing' : 'decreasing'} on both sides`
          : `${P2} does not change sign there`
        out.push({
          kind: 'noinflection',
          text: `The graph of ${F} has no point of inflection at ${at} because ${why2}.`,
          xs: [m.x],
        })
      }
    }
  }

  // ---- the absolute extrema on [a, b]
  const interval = candidateInterval(src, opts, as)
  if (interval) out.push(...candidatesTest(src, interval, as, F))

  // ---- a chart that stops at the window says so
  const cut = [c1, c2].some((c) => c && (c.truncated[0] || c.truncated[1]))
  if (cut) {
    const lo = Math.min(range[0], range[1])
    const hi = Math.max(range[0], range[1])
    out.push({
      kind: 'window',
      text: `These statements cover ${xText(lo)} < x < ${xText(hi)}; outside it the signs keep changing.`,
    })
  }
  return out
}

/** The interval the Candidates Test runs on: the one asked for, else a closed restricted domain. */
function candidateInterval(src: ChartSource, opts: ConclusionOpts, as: ChartLevel): [number, number] | null {
  const iv = opts.interval
  if (iv && Number.isFinite(iv[0]) && Number.isFinite(iv[1]) && iv[1] !== iv[0]) {
    return [Math.min(iv[0], iv[1]), Math.max(iv[0], iv[1])]
  }
  if (as !== 'f' || !src.domain) return null
  const [a, b] = src.domain
  if (!(b > a)) return null
  if (!Number.isFinite(src.valueAt(a)) || !Number.isFinite(src.valueAt(b))) return null
  return [a, b]
}

/** f's value at x in words: "f(−1) = 2", "f(1) ≈ 0.368". */
function valueSay(F: string, x: number, text: string, v: number): string {
  return `${F}(${text})${valueTail(v)}`
}

/**
 * The Candidates Test on [a, b]: f at a, b and every critical point inside;
 * the largest is the absolute maximum, the smallest the absolute minimum — by
 * the Extreme Value Theorem, so only when f is continuous on [a, b].
 *
 * With the graph of f′ shown (as = 'f1') f's values are not known, but their
 * differences are: f(c) = f(a) + ∫ₐᶜ f′(t) dt, which is enough to say WHERE
 * the absolute extrema are.
 */
export function candidatesTest(
  src: ChartSource,
  interval: readonly [number, number],
  as: ChartLevel,
  F = 'f',
): Conclusion[] {
  const [a, b] = interval
  const at = `[${xText(a)}, ${xText(b)}]`
  if (as === 'f2') {
    return [{ kind: 'nocandidates', text: `The Candidates Test needs ${F} or ${F}′; with only ${F}″ shown it cannot be run.` }]
  }
  // EVT: f continuous on [a, b]. With f′ shown, f is continuous wherever f′
  // exists — and at the holes and jumps of f′ — but not across a pole of f′.
  let broken: ReturnType<typeof continuityOn> = []
  try {
    broken = continuityOn(src.base, a, b)
  } catch {
    broken = []
  }
  if (as === 'f1') broken = broken.filter((c) => c.kind === 'pole' || c.kind === 'undefined' || c.kind === 'domain')
  if (broken.length > 0) {
    const c = broken[0]
    const what =
      c.kind === 'domain'
        ? `${as === 'f' ? F : `${F}′`} is not defined at x = ${xText(c.x, c.exact)}`
        : c.kind === 'pole'
          ? `${as === 'f' ? F : `${F}′`} has a vertical asymptote at x = ${xText(c.x, c.exact)}`
          : c.kind === 'undefined'
            ? `${as === 'f' ? F : `${F}′`} is undefined at x = ${xText(c.x, c.exact)}`
            : `${F} is not continuous at x = ${xText(c.x, c.exact)}`
    return [
      {
        kind: 'nocandidates',
        text: `${what}, so ${F} is not known to be continuous on ${at} and the Candidates Test (Extreme Value Theorem) does not apply.`,
      },
    ]
  }
  const chart = signChartOf(src, 'f1', [a, b], as)
  const crit: { x: number; text: string }[] = []
  if (chart) {
    for (const m of chart.marks) {
      if (!(m.x > a && m.x < b) || !m.fOk || m.at === 'jump') continue
      crit.push({ x: m.x, text: m.text })
    }
  }
  const cands = [{ x: a, text: xText(a) }, ...crit, { x: b, text: xText(b) }]
  if (as === 'f') {
    const vals = cands.map((c) => ({ ...c, v: src.valueAt(c.x) }))
    if (vals.some((c) => !Number.isFinite(c.v))) return []
    const list = vals.map((c) => valueSay(F, c.x, c.text, c.v))
    const out: Conclusion[] = [
      {
        kind: 'candidates',
        text: `Candidates Test on ${at}: ${listText(list)}.`,
        xs: vals.map((c) => c.x),
      },
    ]
    out.push(...extremaOf(vals, F, at, (v) => valueTail(v).replace(/^ = /, '').replace(/^ ≈ /, '≈ ')))
    return out
  }
  // f′ shown: f(c) − f(a) = ∫ₐᶜ f′.
  const integral = src.base.integral
  if (!integral) return []
  const vals: { x: number; text: string; v: number }[] = []
  for (const c of cands) {
    if (c.x === a) {
      vals.push({ ...c, v: 0 })
      continue
    }
    const r = integral(a, c.x)
    if (!r || !Number.isFinite(r.value)) return []
    vals.push({ ...c, v: r.value })
  }
  const aT = xText(a)
  const rel = (v: number): string => {
    if (Math.abs(v) <= 1e-12) return `${F}(${aT})`
    const t = valueTail(Math.abs(v))
    const approx = t.startsWith(' ≈')
    const num = t.replace(/^ [=≈] /, '')
    return `${F}(${aT}) ${v > 0 ? '+' : MINUS} ${num}${approx ? ' (approx.)' : ''}`
  }
  const list = vals.filter((c) => c.x !== a).map((c) => `${F}(${c.text}) = ${rel(c.v)}`)
  const out: Conclusion[] = [
    {
      kind: 'candidates',
      text: `Candidates Test on ${at}, using ${F}(x) = ${F}(${aT}) + ∫ from ${aT} to x of ${F}′(t) dt: ${listText(list)}.`,
      xs: vals.map((c) => c.x),
    },
  ]
  out.push(...extremaOf(vals, F, at, null))
  return out
}

/** "The absolute maximum of f on [a, b] is 18, at x = 3." — ties included. */
function extremaOf(
  vals: readonly { x: number; text: string; v: number }[],
  F: string,
  at: string,
  say: ((v: number) => string) | null,
): Conclusion[] {
  if (vals.length === 0) return []
  const vs = vals.map((c) => c.v)
  const mx = Math.max(...vs)
  const mn = Math.min(...vs)
  const tol = 1e-9 * Math.max(1, Math.abs(mx), Math.abs(mn))
  const where = (target: number): { xs: number[]; text: string } => {
    const hit = vals.filter((c) => Math.abs(c.v - target) <= tol)
    return { xs: hit.map((c) => c.x), text: listText(hit.map((c) => `x = ${c.text}`)) }
  }
  const out: Conclusion[] = []
  const top = where(mx)
  const bottom = where(mn)
  if (say) {
    out.push({ kind: 'absmax', text: `The absolute maximum of ${F} on ${at} is ${say(mx)}, at ${top.text}.`, xs: top.xs })
    out.push({ kind: 'absmin', text: `The absolute minimum of ${F} on ${at} is ${say(mn)}, at ${bottom.text}.`, xs: bottom.xs })
  } else {
    out.push({ kind: 'absmax', text: `The absolute maximum of ${F} on ${at} is at ${top.text}.`, xs: top.xs })
    out.push({ kind: 'absmin', text: `The absolute minimum of ${F} on ${at} is at ${bottom.text}.`, xs: bottom.xs })
  }
  return out
}

/** The AP statements for a board curve (see the header). */
export function conclusions(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  range: readonly [number, number],
  opts: ConclusionOpts = {},
): Conclusion[] {
  const src = chartSourceOf(curve, models)
  if (!src) return []
  try {
    return conclusionsOf(src, range, opts)
  } catch {
    return []
  }
}

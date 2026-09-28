// ============================================================================
// src/core/volume.ts — volumes of solids of revolution and of solids with
// known cross-sections (AP Calculus AB/BC Unit 8), as numbers.
//
// The region is always the same object the area-between link shades: the set
// { a ≤ x ≤ b, min(f, g) ≤ y ≤ max(f, g) } with g the second curve, or the
// x-axis (g = 0). Three ways to cut it:
//
//   washer   about a HORIZONTAL axis y = k, slicing in dx:
//              V = π∫ₐᵇ (R(x)² − r(x)²) dx
//            R, r = the distances from the axis to the farther and the nearer
//            boundary at x. The region may lie above the axis or below it (or
//            above in one place and below in another); where it TOUCHES the
//            axis r = 0 and the washer is a disk.
//   shell    about a VERTICAL axis x = k, slicing in dx:
//              V = 2π∫ₐᵇ |x − k|·h(x) dx,   h = top − bottom
//   section  cross-sections perpendicular to the x-axis on the base
//            s(x) = top − bottom:  V = ∫ₐᵇ A(s(x)) dx, A = factor · s²
//
// The other two pairings — washers about a VERTICAL axis and shells about a
// HORIZONTAL one — slice in dy, which needs the region described sideways:
// x as a function of y on each side. `horizontalBands` finds that description
// numerically (monotone pieces of each boundary, inverted by bisection) when
// the region is ONE horizontal strip at every height, and says null when it is
// not; `washerVolumeDy` / `shellVolumeDy` then integrate in y. The solid does
// not depend on how it is sliced, so the dx answer (shells for a vertical
// axis, washers for a horizontal one) is the number, and the dy integral is a
// second, independent measurement of the same solid — the card shows the dy
// integral only when the two agree.
//
// THE AXIS THROUGH THE REGION. Revolving a region that straddles its axis
// sweeps the SAME points twice — the part on the near side is swallowed by the
// part on the far side. The solid is then the region FOLDED across the axis:
//   horizontal axis: at each x the folded slice is [0, max(top − k, k − bot)],
//                    so r = 0 and R is the larger of the two distances;
//   vertical axis:   at each radius ρ the height is the length of the UNION of
//                    the region's slices at x = k − ρ and x = k + ρ, and
//                    V = 2π∫ ρ·U(ρ) dρ.
// Both are computed exactly that way, and `through` is set so the card can say
// "the axis passes through the region" — the textbook formula with R and r
// read off the two curves would count the overlap twice.
//
// Quadrature is tanh-sinh (double exponential) on pieces cut at every place
// the integrand has a kink (where the curves cross, where a boundary meets the
// axis, where the two distances to the axis are equal): it is exact to ~1e-15
// on smooth pieces and shrugs off the endpoint singularity of √x at 0, which
// is what lets 8π be recognised as 8π rather than as 25.1327412.
//
// Pure TypeScript: no DOM, no imports from src/ui.
// ============================================================================

import { exactForm } from './exact'

export type Fn = (x: number) => number

export type VolumeMethod = 'washer' | 'shell' | 'section'

export type SectionShape =
  | 'square'
  | 'semicircle'
  | 'equilateral'
  | 'isoRightLeg'
  | 'isoRightHyp'
  | 'rectangle'

/** The axis of revolution: y = at ('h') or x = at ('v'). */
export interface VolumeAxis {
  dir: 'h' | 'v'
  at: number
}

export const VOLUME_METHODS: readonly VolumeMethod[] = ['washer', 'shell', 'section']

export const SECTION_SHAPES: readonly SectionShape[] = [
  'square',
  'semicircle',
  'equilateral',
  'isoRightLeg',
  'isoRightHyp',
  'rectangle',
]

export const isVolumeMethod = (v: unknown): v is VolumeMethod =>
  v === 'washer' || v === 'shell' || v === 'section'

export const isSectionShape = (v: unknown): v is SectionShape =>
  typeof v === 'string' && (SECTION_SHAPES as readonly string[]).includes(v)

/** The x-axis: the axis a volume link revolves about when it does not say. */
export const X_AXIS: VolumeAxis = { dir: 'h', at: 0 }

/**
 * A(s) = factor · s² for each cross-section on a base of length s:
 *   square s², semicircle (diameter s) πs²/8, equilateral triangle √3s²/4,
 *   isosceles right triangle with a LEG on the base s²/2, with the
 *   HYPOTENUSE on the base s²/4, rectangle of height ratio·s: ratio·s².
 */
export function sectionFactor(shape: SectionShape, ratio = 1): number {
  switch (shape) {
    case 'square':
      return 1
    case 'semicircle':
      return Math.PI / 8
    case 'equilateral':
      return Math.sqrt(3) / 4
    case 'isoRightLeg':
      return 1 / 2
    case 'isoRightHyp':
      return 1 / 4
    case 'rectangle':
      return Number.isFinite(ratio) && ratio > 0 ? ratio : 1
  }
}

// ---------------------------------------------------------------------------
// Quadrature
// ---------------------------------------------------------------------------

export interface Quad {
  value: number
  evals: number
  /** The last two levels agreed to this (absolute). */
  err: number
}

const HALF_PI = Math.PI / 2
/** Abscissae run out to |t| = T_MAX; past it the weights are below 1e-16. */
const T_MAX = 3.2
const TS_MAX_LEVEL = 9
const TS_MIN_LEVEL = 3

/**
 * ∫ₐᵇ f by tanh-sinh quadrature. Null when f is not finite somewhere inside
 * (the caller has already refused poles; a NaN here is a gap nobody saw).
 *
 * The abscissae are placed by their distance from the NEARER end, so a node
 * 1e-20 from b is b − 1e-20·(b − a) and not a rounded copy of b — the reason
 * this rule integrates √x on [0, 4] to the last bit.
 */
export function tanhSinh(f: Fn, a: number, b: number, rel = 1e-13): Quad | null {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  if (a === b) return { value: 0, evals: 0, err: 0 }
  const sign = b > a ? 1 : -1
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  const d = (hi - lo) / 2
  let evals = 0
  let bad = false
  const term = (t: number): number => {
    const u = HALF_PI * Math.sinh(t)
    const cu = Math.cosh(u)
    const w = (HALF_PI * Math.cosh(t)) / (cu * cu)
    if (!(w > 0) || !Number.isFinite(w)) return 0
    // Distance from the nearer end: d·(1 − |tanh u|) = 2d / (1 + e^{2|u|}).
    const delta = (2 * d) / (1 + Math.exp(2 * Math.abs(u)))
    const x = t > 0 ? hi - delta : t < 0 ? lo + delta : (lo + hi) / 2
    evals++
    let y: number
    try {
      y = f(x)
    } catch {
      y = Number.NaN
    }
    if (!Number.isFinite(y)) {
      // A weight this small cannot move the answer; anything bigger is a hole.
      if (w * d < 1e-200) return 0
      bad = true
      return 0
    }
    return w * y
  }
  let h = 1
  let sum = term(0)
  for (let k = 1; k <= Math.floor(T_MAX); k++) sum += term(k) + term(-k)
  let prev = d * h * sum
  let err = Infinity
  for (let level = 1; level <= TS_MAX_LEVEL; level++) {
    h /= 2
    let add = 0
    for (let t = h; t <= T_MAX; t += 2 * h) add += term(t) + term(-t)
    if (bad) return null
    sum += add
    const now = d * h * sum
    err = Math.abs(now - prev)
    prev = now
    if (level >= TS_MIN_LEVEL && err <= rel * Math.max(Math.abs(now), 1e-300)) break
  }
  if (bad || !Number.isFinite(prev)) return null
  return { value: sign * prev, evals, err }
}

/**
 * ∫ over [lo, hi] cut at `cuts`: one tanh-sinh per smooth piece, so a kink in
 * the integrand (the curves crossing, a boundary meeting the axis) never sits
 * inside a piece.
 */
export function integratePieces(f: Fn, lo: number, hi: number, cuts: readonly number[]): Quad | null {
  const pts = [lo, ...cuts.filter((c) => c > lo && c < hi).sort((p, q) => p - q), hi]
  let value = 0
  let evals = 0
  let err = 0
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i]
    const q = pts[i + 1]
    if (!(q > p)) continue
    const r = tanhSinh(f, p, q)
    if (!r) return null
    value += r.value
    evals += r.evals
    err += r.err
  }
  return { value, evals, err }
}

// ---------------------------------------------------------------------------
// Roots and monotone pieces
// ---------------------------------------------------------------------------

const SCAN_N = 400

/** Every x in (lo, hi) where h changes sign (or is exactly 0 at a sample), sorted. */
export function signChanges(h: Fn, lo: number, hi: number, n = SCAN_N): number[] {
  if (!(hi > lo)) return []
  const out: number[] = []
  const step = (hi - lo) / n
  let px = lo
  let pv = safe(h, lo)
  for (let i = 1; i <= n; i++) {
    const x = i === n ? hi : lo + i * step
    const v = safe(h, x)
    if (Number.isFinite(pv) && Number.isFinite(v)) {
      if (v === 0 && i < n) out.push(x)
      else if (pv !== 0 && v !== 0 && pv < 0 !== v < 0) out.push(bisect(h, px, x, pv))
    }
    px = x
    pv = v
  }
  const tol = 1e-12 * Math.max(1, Math.abs(lo), Math.abs(hi))
  return out.filter((x, i) => x > lo + tol && x < hi - tol && (i === 0 || x - out[i - 1] > tol))
}

function safe(f: Fn, x: number): number {
  try {
    const v = f(x)
    return typeof v === 'number' ? v : Number.NaN
  } catch {
    return Number.NaN
  }
}

/** A sign change of h in [p, q] (h(p) = hp), to the last bit. */
function bisect(h: Fn, p: number, q: number, hp: number): number {
  let lo = p
  let hi = q
  let flo = hp
  for (let i = 0; i < 80; i++) {
    const m = (lo + hi) / 2
    if (m <= lo || m >= hi) break
    const fm = safe(h, m)
    if (!Number.isFinite(fm)) break
    if (fm === 0) return m
    if (fm < 0 === flo < 0) {
      lo = m
      flo = fm
    } else hi = m
  }
  return (lo + hi) / 2
}

/** One stretch of [lo, hi] on which F is monotone — or flat. */
export interface MonoPiece {
  lo: number
  hi: number
  /** F rises (true) or falls (false); meaningless when flat. */
  inc: boolean
  flat: boolean
}

/** The stretches of [lo, hi] on which F is monotone, turning points refined. */
export function monotonePieces(F: Fn, lo: number, hi: number, n = SCAN_N): MonoPiece[] {
  if (!(hi > lo)) return []
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i <= n; i++) {
    const x = i === n ? hi : lo + ((hi - lo) * i) / n
    xs.push(x)
    ys.push(safe(F, x))
  }
  let scale = 0
  for (const y of ys) if (Number.isFinite(y)) scale = Math.max(scale, Math.abs(y))
  const tol = 1e-12 * Math.max(1, scale)
  const sgn: number[] = []
  for (let i = 0; i < n; i++) {
    const dv = ys[i + 1] - ys[i]
    sgn.push(!Number.isFinite(dv) ? 0 : Math.abs(dv) <= tol ? 0 : dv > 0 ? 1 : -1)
  }
  // Runs of one sign; the boundary between a rise and a fall is refined to the
  // turning point itself.
  const cuts: number[] = []
  const kinds: number[] = []
  let run = sgn[0]
  kinds.push(run)
  for (let i = 1; i < n; i++) {
    if (sgn[i] === run) continue
    let at = xs[i]
    if (run !== 0 && sgn[i] !== 0) {
      at = turningPoint(F, xs[i - 1], xs[i + 1], run > 0)
    }
    cuts.push(at)
    run = sgn[i]
    kinds.push(run)
  }
  const out: MonoPiece[] = []
  let left = lo
  for (let i = 0; i <= cuts.length; i++) {
    const right = i < cuts.length ? cuts[i] : hi
    const k = kinds[i]
    if (right > left) {
      const flat = k === 0 || Math.abs(safe(F, right) - safe(F, left)) <= tol
      const prev = out[out.length - 1]
      if (prev && prev.flat && flat) prev.hi = right
      else out.push({ lo: left, hi: right, inc: k > 0, flat })
    }
    left = right
  }
  return out
}

/** The max (or min) of F in [p, q] by golden section. */
function turningPoint(F: Fn, p: number, q: number, isMax: boolean): number {
  const g = (Math.sqrt(5) - 1) / 2
  let a = p
  let b = q
  const val = (x: number): number => (isMax ? safe(F, x) : -safe(F, x))
  let c = b - g * (b - a)
  let d = a + g * (b - a)
  let fc = val(c)
  let fd = val(d)
  for (let i = 0; i < 90 && b - a > 1e-15 * Math.max(1, Math.abs(a)); i++) {
    if (fc > fd) {
      b = d
      d = c
      fd = fc
      c = b - g * (b - a)
      fc = val(c)
    } else {
      a = c
      c = d
      fc = fd
      d = a + g * (b - a)
      fd = val(d)
    }
  }
  return (a + b) / 2
}

// ---------------------------------------------------------------------------
// The region
// ---------------------------------------------------------------------------

/** The region between f and g (g ≡ 0: the x-axis) over [a, b]. */
export interface Region {
  f: Fn
  g: Fn
  a: number
  b: number
}

export const topOf = (r: Region): Fn => (x) => Math.max(r.f(x), r.g(x))
export const botOf = (r: Region): Fn => (x) => Math.min(r.f(x), r.g(x))

const lohi = (r: Region): [number, number] => [Math.min(r.a, r.b), Math.max(r.a, r.b)]

/** Where the curves cross inside (a, b). */
export function crossings(r: Region): number[] {
  const [lo, hi] = lohi(r)
  return signChanges((x) => r.f(x) - r.g(x), lo, hi)
}

export interface VolumeResult {
  value: number
  /** The axis of revolution passes through the inside of the region. */
  through: boolean
  /** The quadrature's own error estimate (absolute). */
  err: number
}

/** A small length on the region's own scale, for "strictly inside" tests. */
function slack(r: Region, k: number): number {
  const [lo, hi] = lohi(r)
  let s = Math.abs(k)
  for (let i = 0; i <= 64; i++) {
    const x = lo + ((hi - lo) * i) / 64
    const f = Math.abs(r.f(x))
    const g = Math.abs(r.g(x))
    if (Number.isFinite(f)) s = Math.max(s, f)
    if (Number.isFinite(g)) s = Math.max(s, g)
  }
  return 1e-9 * Math.max(1, s, hi - lo)
}

/** True when a horizontal line y = k runs through the inside of the region somewhere. */
export function horizontalAxisThrough(r: Region, k: number): boolean {
  const [lo, hi] = lohi(r)
  const eps = slack(r, k)
  for (let i = 1; i < 256; i++) {
    const x = lo + ((hi - lo) * i) / 256
    const t = Math.max(r.f(x), r.g(x)) - k
    const u = k - Math.min(r.f(x), r.g(x))
    if (t > eps && u > eps) return true
  }
  return false
}

/** True when a vertical line x = k runs through the inside of the region. */
export function verticalAxisThrough(r: Region, k: number): boolean {
  const [lo, hi] = lohi(r)
  const eps = 1e-9 * Math.max(1, Math.abs(k), hi - lo)
  if (!(k > lo + eps && k < hi - eps)) return false
  const h = Math.abs(r.f(k) - r.g(k))
  // The line meets the region in more than a point wherever the region has
  // height there, or anywhere near it (a crossing exactly at k is a pinch).
  if (h > slack(r, 0)) return true
  const e = (hi - lo) * 1e-3
  return Math.abs(r.f(k - e) - r.g(k - e)) > 0 || Math.abs(r.f(k + e) - r.g(k + e)) > 0
}

/**
 * Washers (disks) about y = k, slicing in dx. The region may sit above the
 * axis, below it, or straddle it (then r = 0 and R is the larger distance —
 * the solid the region actually sweeps; see the header).
 */
export function washerVolume(r: Region, k: number): VolumeResult | null {
  const [lo, hi] = lohi(r)
  const top = topOf(r)
  const bot = botOf(r)
  const integrand: Fn = (x) => {
    const t = top(x) - k
    const u = bot(x) - k
    if (!Number.isFinite(t) || !Number.isFinite(u)) return Number.NaN
    if (u >= 0) return t * t - u * u
    if (t <= 0) return u * u - t * t
    return Math.max(t * t, u * u)
  }
  const cuts = [
    ...crossings(r),
    ...signChanges((x) => r.f(x) - k, lo, hi),
    ...signChanges((x) => r.g(x) - k, lo, hi),
    ...signChanges((x) => r.f(x) + r.g(x) - 2 * k, lo, hi),
  ]
  const q = integratePieces(integrand, lo, hi, cuts)
  if (!q) return null
  return { value: Math.PI * q.value, through: horizontalAxisThrough(r, k), err: Math.PI * q.err }
}

/**
 * Shells about x = k, slicing in dx: 2π∫|x − k|·h(x) dx when the region is on
 * one side of the axis; the folded solid 2π∫ρ·U(ρ)dρ when the axis runs
 * through it (see the header).
 */
export function shellVolume(r: Region, k: number): VolumeResult | null {
  const [lo, hi] = lohi(r)
  const height: Fn = (x) => Math.abs(r.f(x) - r.g(x))
  if (!verticalAxisThrough(r, k)) {
    const integrand: Fn = (x) => Math.abs(x - k) * height(x)
    const cuts = [...crossings(r), k]
    const q = integratePieces(integrand, lo, hi, cuts)
    if (!q) return null
    return { value: 2 * Math.PI * q.value, through: false, err: 2 * Math.PI * q.err }
  }
  // Folded: at radius ρ the union of the slices at k − ρ and k + ρ.
  const top = topOf(r)
  const bot = botOf(r)
  const slice = (x: number): [number, number] | null =>
    x >= lo && x <= hi ? [bot(x), top(x)] : null
  const union: Fn = (rho) => {
    const p = slice(k - rho)
    const q = slice(k + rho)
    if (!p && !q) return 0
    if (!p) return (q as [number, number])[1] - (q as [number, number])[0]
    if (!q) return p[1] - p[0]
    const overlap = Math.max(0, Math.min(p[1], q[1]) - Math.max(p[0], q[0]))
    return p[1] - p[0] + (q[1] - q[0]) - overlap
  }
  const near = Math.min(k - lo, hi - k)
  const far = Math.max(k - lo, hi - k)
  // Kinks of U: where one side's slice starts overlapping the other's.
  const cuts = [
    near,
    ...signChanges((rho) => top(k - rho) - top(k + rho), 0, near),
    ...signChanges((rho) => bot(k - rho) - bot(k + rho), 0, near),
    ...signChanges((rho) => top(k - rho) - bot(k + rho), 0, near),
    ...signChanges((rho) => bot(k - rho) - top(k + rho), 0, near),
  ]
  const q = integratePieces((rho) => rho * union(rho), 0, far, cuts)
  if (!q) return null
  return { value: 2 * Math.PI * q.value, through: true, err: 2 * Math.PI * q.err }
}

/** Known cross-sections perpendicular to the x-axis: ∫ A(s(x)) dx. */
export function sectionVolume(r: Region, shape: SectionShape, ratio = 1): VolumeResult | null {
  const [lo, hi] = lohi(r)
  const factor = sectionFactor(shape, ratio)
  const q = integratePieces(
    (x) => {
      const s = r.f(x) - r.g(x)
      return s * s
    },
    lo,
    hi,
    crossings(r),
  )
  if (!q) return null
  return { value: factor * q.value, through: false, err: factor * q.err }
}

/**
 * The solid of revolution about any axis, measured the reliable way: washers
 * in dx about a horizontal axis, shells in dx about a vertical one.
 */
export function revolutionVolume(r: Region, axis: VolumeAxis): VolumeResult | null {
  return axis.dir === 'h' ? washerVolume(r, axis.at) : shellVolume(r, axis.at)
}

// ---------------------------------------------------------------------------
// Slicing in dy
// ---------------------------------------------------------------------------

/** One side of a horizontal slice: a monotone stretch of f or g, or an end of [a, b]. */
export type SideRef =
  | { kind: 'curve'; which: 'f' | 'g'; lo: number; hi: number; inc: boolean }
  | { kind: 'edge'; x: number }

/** A stretch of heights over which the region's slice runs from `left` to `right`. */
export interface Band {
  y0: number
  y1: number
  left: SideRef
  right: SideRef
}

const sameRef = (p: SideRef, q: SideRef): boolean =>
  p.kind === 'edge'
    ? q.kind === 'edge' && p.x === q.x
    : q.kind === 'curve' && p.which === q.which && p.lo === q.lo && p.hi === q.hi

/** x on this side at height y (bisection on a monotone stretch). */
export function sideX(r: Region, side: SideRef, y: number): number {
  if (side.kind === 'edge') return side.x
  const F = side.which === 'f' ? r.f : r.g
  let lo = side.lo
  let hi = side.hi
  // F − y rises on an increasing stretch, falls on a decreasing one.
  const s = side.inc ? 1 : -1
  for (let i = 0; i < 100; i++) {
    const m = (lo + hi) / 2
    if (m <= lo || m >= hi) break
    const v = s * (safe(F, m) - y)
    if (!Number.isFinite(v)) return Number.NaN
    if (v < 0) lo = m
    else hi = m
  }
  return (lo + hi) / 2
}

/**
 * The region described sideways: bands of heights on each of which the slice
 * at height y is ONE interval [x_left(y), x_right(y)] with the same two sides
 * throughout. Null when some height cuts the region in two or more pieces —
 * slicing in dy then needs more than one washer per height, and the card says
 * to use the other method.
 */
export function horizontalBands(r: Region): Band[] | null {
  const [lo, hi] = lohi(r)
  if (!(hi > lo)) return null
  const sides: { ref: SideRef; y0: number; y1: number }[] = []
  const ys: number[] = []
  for (const which of ['f', 'g'] as const) {
    const F = which === 'f' ? r.f : r.g
    for (const p of monotonePieces(F, lo, hi)) {
      const ya = safe(F, p.lo)
      const yb = safe(F, p.hi)
      if (!Number.isFinite(ya) || !Number.isFinite(yb)) return null
      ys.push(ya, yb)
      if (p.flat) continue
      sides.push({
        ref: { kind: 'curve', which, lo: p.lo, hi: p.hi, inc: p.inc },
        y0: Math.min(ya, yb),
        y1: Math.max(ya, yb),
      })
    }
  }
  for (const x of [lo, hi]) {
    const ya = safe(r.f, x)
    const yb = safe(r.g, x)
    if (!Number.isFinite(ya) || !Number.isFinite(yb)) return null
    ys.push(ya, yb)
    if (Math.abs(ya - yb) > 0) {
      sides.push({ ref: { kind: 'edge', x }, y0: Math.min(ya, yb), y1: Math.max(ya, yb) })
    }
  }
  for (const x of crossings(r)) ys.push(r.f(x))
  ys.sort((p, q) => p - q)
  const span = ys[ys.length - 1] - ys[0]
  const tol = 1e-10 * Math.max(1, Math.abs(ys[0]), Math.abs(ys[ys.length - 1]), span)
  const levels: number[] = []
  for (const y of ys) if (levels.length === 0 || y - levels[levels.length - 1] > tol) levels.push(y)
  const bands: Band[] = []
  for (let i = 0; i + 1 < levels.length; i++) {
    const y0 = levels[i]
    const y1 = levels[i + 1]
    const ym = (y0 + y1) / 2
    const hits: { x: number; ref: SideRef }[] = []
    for (const s of sides) {
      if (!(ym > s.y0 && ym < s.y1)) continue
      hits.push({ x: sideX(r, s.ref, ym), ref: s.ref })
    }
    if (hits.length === 0) continue
    if (hits.length !== 2) return null
    hits.sort((p, q) => p.x - q.x)
    const prev = bands[bands.length - 1]
    if (prev && prev.y1 === y0 && sameRef(prev.left, hits[0].ref) && sameRef(prev.right, hits[1].ref)) {
      prev.y1 = y1
    } else {
      bands.push({ y0, y1, left: hits[0].ref, right: hits[1].ref })
    }
  }
  return bands.length > 0 ? bands : null
}

/** Washers about x = k, slicing in dy, over the bands. */
export function washerVolumeDy(r: Region, bands: readonly Band[], k: number): VolumeResult | null {
  let total = 0
  let err = 0
  let through = false
  for (const band of bands) {
    // Kinks: where a side crosses the axis, and where the two sides are
    // equally far from it (R switches sides when the axis runs through).
    const xl: Fn = (y) => sideX(r, band.left, y) - k
    const xr: Fn = (y) => sideX(r, band.right, y) - k
    const cuts = [
      ...signChanges(xl, band.y0, band.y1, 64),
      ...signChanges(xr, band.y0, band.y1, 64),
      ...signChanges((y) => xl(y) + xr(y), band.y0, band.y1, 64),
    ]
    const q = integratePieces(
      (y) => {
        const L = sideX(r, band.left, y) - k
        const Rr = sideX(r, band.right, y) - k
        if (!Number.isFinite(L) || !Number.isFinite(Rr)) return Number.NaN
        if (L >= 0) return Rr * Rr - L * L
        if (Rr <= 0) return L * L - Rr * Rr
        through = true
        return Math.max(L * L, Rr * Rr)
      },
      band.y0,
      band.y1,
      cuts,
    )
    if (!q) return null
    total += q.value
    err += q.err
  }
  return { value: Math.PI * total, through, err: Math.PI * err }
}

/** Shells about y = k, slicing in dy, over the bands (the axis must not run through). */
export function shellVolumeDy(r: Region, bands: readonly Band[], k: number): VolumeResult | null {
  let total = 0
  let err = 0
  for (const band of bands) {
    const q = integratePieces(
      (y) => Math.abs(y - k) * (sideX(r, band.right, y) - sideX(r, band.left, y)),
      band.y0,
      band.y1,
      [k],
    )
    if (!q) return null
    total += q.value
    err += q.err
  }
  return { value: 2 * Math.PI * total, through: false, err: 2 * Math.PI * err }
}

// ---------------------------------------------------------------------------
// Exact forms
// ---------------------------------------------------------------------------

export interface ExactVolume {
  text: string
  tex: string
}

/** p/q with q ≤ 64 within a relative 1e-10, or null. */
export function smallRational(v: number, rel = 1e-10): { p: number; q: number } | null {
  if (!Number.isFinite(v)) return null
  const tol = rel * Math.max(1, Math.abs(v))
  for (let q = 1; q <= 64; q++) {
    const p = Math.round(v * q)
    if (Math.abs(p / q - v) <= tol && Math.abs(p) <= 1e6) {
      const g = gcd(Math.abs(p), q)
      return { p: p / g, q: q / g }
    }
  }
  return null
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b]
  return a || 1
}

/** "8π", "2π/15", "π/6", "16π/3" and their LaTeX. */
export function piMultiple(p: number, q: number): ExactVolume {
  const neg = p < 0 ? '−' : ''
  const negTex = p < 0 ? '-' : ''
  const P = Math.abs(p)
  if (P === 0) return { text: '0', tex: '0' }
  const num = P === 1 ? 'π' : `${P}π`
  const numTex = P === 1 ? '\\pi' : `${P}\\pi`
  if (q === 1) return { text: `${neg}${num}`, tex: `${negTex}${numTex}` }
  return { text: `${neg}${num}/${q}`, tex: `${negTex}\\frac{${numTex}}{${q}}` }
}

/**
 * V as a closed form, or null. A rational multiple of π first (every solid of
 * revolution of a polynomial region, and semicircular sections), then the
 * closed forms exact.ts knows (8, 2√3, π/2 …). `err` is the quadrature's own
 * error estimate: a number measured to 1e-6 is never dressed up as 2π/15.
 */
export function exactVolume(v: number, err = 0): ExactVolume | null {
  if (!Number.isFinite(v) || v < 0) return null
  if (v === 0) return { text: '0', tex: '0' }
  if (!(err <= 1e-9 * Math.max(1, Math.abs(v)))) return null
  const plain = smallRational(v)
  if (plain && plain.q <= 32) return rationalText(plain.p, plain.q)
  const overPi = smallRational(v / Math.PI)
  if (overPi) return piMultiple(overPi.p, overPi.q)
  // Shells and washers of a trig region: 2π², π²/2.
  const overPi2 = smallRational(v / (Math.PI * Math.PI))
  if (overPi2 && overPi2.q <= 32) {
    const m = piMultiple(overPi2.p, overPi2.q)
    return { text: m.text.replace('π', 'π²'), tex: m.tex.replace('\\pi', '\\pi^{2}') }
  }
  const ex = exactForm(v)
  if (ex) return { text: ex.text, tex: ex.tex }
  if (plain) return rationalText(plain.p, plain.q)
  return null
}

function rationalText(p: number, q: number): ExactVolume {
  if (q === 1) return { text: `${p}`.replace('-', '−'), tex: `${p}` }
  return { text: `${p}/${q}`.replace('-', '−'), tex: `\\frac{${p}}{${q}}` }
}

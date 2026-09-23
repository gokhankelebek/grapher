// ============================================================================
// src/ui/curveState.ts — questions the UI asks about a curve.
//
// Three of them, all pure, all measured rather than guessed:
//
//   curveScale(curve, spec)   How big is this curve? The readouts need it:
//                             formatCoord's zero floor tracks the graph, and a
//                             midline of 0.0005 printed as "5.09e-4" beside a
//                             wave of height 6.5 is the bug that asked for it.
//   curveBounds(curve, spec)  Where does it live? "Fit to curves" frames every
//                             visible curve, which means knowing each one's box.
//   alignedValues(values)     One decimal precision for a group of readouts, so
//                             a column of coefficients lines up on the point.
//
// They are here, in a module of their own, because they are the parts of the
// card and the toolbar that can be tested without a DOM.
// ============================================================================

import type { FittedCurve, ModelSpec, Vec2 } from '../core/types'
import { formatSig } from './numeric'

/** Samples taken across a curve when it has to be measured. */
const SAMPLES = 129

/** Beyond this a value is an asymptote running away, not part of the figure. */
const RUNAWAY = 1e6

export interface Box {
  min: Vec2
  max: Vec2
}

const finite = (v: number): boolean => Number.isFinite(v) && Math.abs(v) <= RUNAWAY

/**
 * The x-window a curve is measured over: its own domain when it has one,
 * otherwise the window the caller is looking at.
 */
function windowOf(
  domain: [number, number] | null,
  fallback: [number, number],
): [number, number] {
  if (domain && Number.isFinite(domain[0]) && Number.isFinite(domain[1]) && domain[1] > domain[0]) {
    return domain
  }
  return fallback
}

/** Points on the curve, in math coords. Empty when it cannot be sampled. */
export function curvePoints(
  curve: FittedCurve,
  spec: ModelSpec | undefined,
  fallback: [number, number] = [-8, 8],
): Vec2[] {
  if (!spec) return []
  const out: Vec2[] = []
  try {
    if (spec.evalExplicit) {
      const [lo, hi] = windowOf(curve.domain, fallback)
      for (let i = 0; i < SAMPLES; i++) {
        const x = lo + ((hi - lo) * i) / (SAMPLES - 1)
        const y = spec.evalExplicit(curve.params, x)
        if (finite(x) && finite(y)) out.push({ x, y })
      }
      return out
    }
    if (spec.evalPolar) {
      const [lo, hi] = windowOf(curve.domain, [0, Math.PI * 2])
      for (let i = 0; i < SAMPLES; i++) {
        const t = lo + ((hi - lo) * i) / (SAMPLES - 1)
        const r = spec.evalPolar(curve.params, t)
        if (!finite(r)) continue
        const p = { x: r * Math.cos(t), y: r * Math.sin(t) }
        if (finite(p.x) && finite(p.y)) out.push(p)
      }
      return out
    }
    if (spec.evalParametric) {
      const [lo, hi] = windowOf(curve.domain, [-10, 10])
      for (let i = 0; i < SAMPLES; i++) {
        const t = lo + ((hi - lo) * i) / (SAMPLES - 1)
        const p = spec.evalParametric(curve.params, t)
        if (p && finite(p.x) && finite(p.y)) out.push(p)
      }
      return out
    }
  } catch {
    return []
  }
  return out
}

/**
 * A box that contains this curve.
 *
 * An implicit family (circle, ellipse) has no parameterisation to walk, so it
 * is measured from the ink it was fitted to — which is exactly where the user
 * drew it. Null when there is nothing to measure, and the caller leaves that
 * curve out of the frame rather than inventing a box for it.
 */
export function curveBounds(
  curve: FittedCurve,
  spec: ModelSpec | undefined,
  fallback: [number, number] = [-8, 8],
): Box | null {
  let pts = curvePoints(curve, spec, fallback)
  if (pts.length === 0 && curve.sourceStroke && curve.sourceStroke.length > 0) {
    pts = curve.sourceStroke.filter((p) => p && finite(p.x) && finite(p.y))
  }
  if (pts.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } }
}

/** The union of several boxes, or null when there are none. */
export function unionBoxes(boxes: readonly (Box | null)[]): Box | null {
  let out: Box | null = null
  for (const b of boxes) {
    if (!b) continue
    if (!out) {
      out = { min: { ...b.min }, max: { ...b.max } }
      continue
    }
    out.min.x = Math.min(out.min.x, b.min.x)
    out.min.y = Math.min(out.min.y, b.min.y)
    out.max.x = Math.max(out.max.x, b.max.x)
    out.max.y = Math.max(out.max.y, b.max.y)
  }
  return out
}

/**
 * The magnitude this curve's numbers live at — its y-extent over its own
 * domain, falling back to its x-extent for a figure that is not a function
 * (a circle's y-range is its diameter either way).
 *
 * This is the `scale` formatCoord and formatSig take. Zero and non-finite
 * results are reported as undefined, which means "no scale is known" and
 * leaves the formatters on their bare arithmetic floor.
 */
export function curveScale(
  curve: FittedCurve,
  spec: ModelSpec | undefined,
  fallback: [number, number] = [-8, 8],
): number | undefined {
  const box = curveBounds(curve, spec, fallback)
  if (!box) return undefined
  const dx = box.max.x - box.min.x
  // A pole throws a handful of samples out to 10⁴ and beyond; the full extent
  // would then make every ordinary value on the curve look like residue. The
  // span between the 5th and 95th percentile of the sampled heights is the
  // size the curve's numbers actually live at.
  let dy = box.max.y - box.min.y
  const ys = curvePoints(curve, spec, fallback)
    .map((p) => p.y)
    .filter(finite)
    .sort((a, b) => a - b)
  if (ys.length >= 20) {
    const at = (q: number): number => ys[Math.min(ys.length - 1, Math.max(0, Math.round(q * (ys.length - 1))))]
    const robust = at(0.95) - at(0.05)
    if (robust > 0 && robust < dy) dy = robust
  }
  // The y-extent is the one the readouts are measured against; a flat curve
  // (y = 3) has none, and then its horizontal run is the only size it has.
  const scale = Number.isFinite(dy) && dy > 0 ? dy : dx
  if (!Number.isFinite(scale) || scale <= 0) return undefined
  return scale
}

/**
 * The size of the x-range a curve's points are read over: its x-extent.
 * Floors x readouts the way curveScale floors y — a sketched vertex at
 * x = 0.0005 on a ±8 board is the 0 it looks like — without ever tying an x
 * to how tall the graph is.
 */
export function curveXScale(
  curve: FittedCurve,
  spec: ModelSpec | undefined,
  fallback: [number, number] = [-8, 8],
): number | undefined {
  const box = curveBounds(curve, spec, fallback)
  if (!box) return undefined
  const dx = box.max.x - box.min.x
  return Number.isFinite(dx) && dx > 0 ? dx : undefined
}

/**
 * One precision for a group of readouts.
 *
 * A column that mixes 4-significant-digit renderings ("2.000", "0.7789",
 * "12.34") does not line up on the decimal point, because each row picked its
 * own number of decimals. So the group picks ONE: enough decimals for the
 * smallest value in it to keep four significant digits, capped so a large
 * coefficient does not drag the column out to nine characters.
 *
 * Values that need exponential notation (very large, very small) opt the whole
 * group out — there is nothing to align — and each row falls back to formatSig.
 */
export function alignedValues(values: readonly number[], scale?: number): string[] {
  const opts = scale === undefined ? undefined : { scale }
  const usable = values.filter((v) => Number.isFinite(v))
  if (usable.length === 0) return values.map((v) => formatSig(v, opts))

  const shown = usable.map((v) => (Math.abs(v) <= zeroCut(scale) ? 0 : v))
  const big = shown.some((v) => Math.abs(v) >= 1e5)
  const small = shown.some((v) => v !== 0 && Math.abs(v) < 1e-4)
  if (big || small) return values.map((v) => formatSig(v, opts))

  let decimals = 0
  for (const v of shown) {
    if (v === 0) continue
    const mag = Math.floor(Math.log10(Math.abs(v)))
    decimals = Math.max(decimals, Math.min(4, Math.max(0, 3 - mag)))
  }
  return values.map((v) => {
    if (!Number.isFinite(v)) return '—'
    const z = Math.abs(v) <= zeroCut(scale) ? 0 : v
    const text = z.toFixed(decimals)
    // toFixed(0) on a negative zero gives "-0"; and a column of values should
    // use the same minus sign the coordinate readouts do.
    const cleaned = /^-0(\.0*)?$/.test(text) ? text.slice(1) : text
    return cleaned.startsWith('-') ? '−' + cleaned.slice(1) : cleaned
  })
}

/** The floor below which a value in a group of this scale is simply zero. */
function zeroCut(scale?: number): number {
  if (scale === undefined || !Number.isFinite(scale) || scale <= 0) return 1e-12
  return 1e-4 * scale
}

/**
 * Has this curve stopped being a reading of its own ink?
 *
 * σ is the RMS distance between the ink and the fit. The moment a coefficient
 * is typed, a feature is stated or a handle is dragged, that number stops being
 * a property of the equation on the card and becomes a fact about a sketch the
 * curve no longer matches — so the card hides it rather than keep a stale
 * number on screen with a Greek letter in front of it.
 */
export function derivesFromInk(curve: FittedCurve, edited: boolean): boolean {
  if (edited) return false
  if (curve.modelId.startsWith('expr_')) return false
  if (!curve.sourceStroke || curve.sourceStroke.length === 0) return false
  return Number.isFinite(curve.error)
}

/**
 * Split a stage notice into its sentence and whether it offers an undo.
 *
 * The stage says "Blended into this curve · Undo" — a word that looks like a
 * button and was not one. The board turns the tail into a real button and
 * shows the rest as the message, so the offer is something a teacher can press
 * rather than something they can only read.
 */
export function splitNotice(text: string): { msg: string; undoable: boolean } {
  const undoable = /\s·\s*undo\s*$/i.test(text)
  return { msg: undoable ? text.replace(/\s·\s*undo\s*$/i, '') : text, undoable }
}

// ============================================================================
// Numerical solution curves for slope fields (src/core/ode.ts):
//
//   export function solveField(f, through, range, opts?): Vec2[]
//   export function sampleField(f, xs, ys): Float64Array
//
// Given dy/dx = f(x, y) and one point the curve must pass through, integrate
// RK4 forward to range[1] and backward to range[0] and hand back the whole
// path in increasing-x order, `through` included.
//
// Why adaptive: the AP classics misbehave in three different ways and a fixed
// step gets all three wrong.
//   y' = y^2   through (0, 1)   blows up at x = 1   -> must stop, not spray
//   y' = -x/y  through (0, 2)   vertical at x = +-2 -> must stop, not cross
//   y' = 1/x   through (1, 0)   pole at x = 0       -> must stop short of it
// So each step is taken twice — once whole, once as two halves — and the
// difference is both the error estimate and (by Richardson extrapolation) a
// free order of accuracy. A step whose error is too large is rejected and the
// step halved; a step whose error is comfortably small doubles the next one.
// Where the solution turns vertical the halving never converges, and the
// slope cap below stops the direction cleanly with the last good point still
// on the curve.
//
// Guarantees the renderer relies on:
//   * every returned point is finite (no NaN, ever)
//   * x is STRICTLY increasing across the whole array
//   * `through` is in the array, exactly as given
// ============================================================================

import type { Vec2 } from './types'

export interface SolveOpts {
  /** local error per step, relative to max(1, |y|). Default 1e-10. */
  tol?: number
  /** hard cap on RK4 steps across both directions. Default 20000. */
  maxSteps?: number
}

const DEFAULT_TOL = 1e-10
const DEFAULT_MAX_STEPS = 20_000

/** Start at width/400; never grow past width/200, so a curve stays smooth. */
const H0_DIVISOR = 400
const HMAX_DIVISOR = 200
/** Below width * this, the step has stopped making progress — give up. */
const HMIN_FACTOR = 1e-12
/** |f| past this is a vertical tangent or a pole, not a slope worth following. */
const SLOPE_CAP = 1e6
/** |y| past this multiple of the starting scale is a blow-up. */
const BLOWUP_FACTOR = 1e6
/** Error this far under tolerance means the step can safely double. */
const GROW_MARGIN = 1 / 32
/** Consecutive rejections before a direction is declared stuck. */
const MAX_RETRIES = 60

/** One RK4 step of size h from (x, y). Returns NaN if any stage is non-finite. */
function rk4(f: (x: number, y: number) => number, x: number, y: number, h: number): number {
  const k1 = f(x, y)
  if (!Number.isFinite(k1)) return NaN
  const h2 = h / 2
  const k2 = f(x + h2, y + h2 * k1)
  if (!Number.isFinite(k2)) return NaN
  const k3 = f(x + h2, y + h2 * k2)
  if (!Number.isFinite(k3)) return NaN
  const k4 = f(x + h, y + h * k3)
  if (!Number.isFinite(k4)) return NaN
  return y + (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4)
}

interface Budget { left: number }

/**
 * Integrate from (x0, y0) towards `limit`. `dir` is +1 or -1; steps are always
 * taken with a positive size and signed on the way in, so x moves monotonically
 * and the caller can concatenate without sorting.
 *
 * Returns the points AFTER the start, in the order they were computed.
 */
function march(
  f: (x: number, y: number) => number,
  x0: number,
  y0: number,
  limit: number,
  dir: 1 | -1,
  width: number,
  tol: number,
  budget: Budget,
): Vec2[] {
  const out: Vec2[] = []
  const hMax = width / HMAX_DIVISOR
  const hMin = width * HMIN_FACTOR
  const yScale = Math.max(1, Math.abs(y0))
  const blowup = BLOWUP_FACTOR * yScale

  let x = x0
  let y = y0
  let h = Math.min(width / H0_DIVISOR, hMax)
  let retries = 0

  while (budget.left > 0) {
    const remaining = (limit - x) * dir
    if (remaining <= hMin) break
    if (h > remaining) h = remaining

    // A vertical tangent or a pole: the last accepted point is the honest
    // end of the curve, so stop rather than stepping over the singularity.
    const slope = f(x, y)
    if (!Number.isFinite(slope) || Math.abs(slope) > SLOPE_CAP) break

    const sh = h * dir
    budget.left--
    const whole = rk4(f, x, y, sh)
    const mid = rk4(f, x, y, sh / 2)
    const half = Number.isFinite(mid) ? rk4(f, x + sh / 2, mid, sh / 2) : NaN

    if (!Number.isFinite(whole) || !Number.isFinite(half)) {
      if (h <= hMin || ++retries > MAX_RETRIES) break
      h /= 2
      continue
    }

    // Richardson: |half - whole| / 15 estimates the error in `half`, and
    // adding that difference back in buys an extra order for free.
    const diff = half - whole
    const err = Math.abs(diff) / 15
    const allow = tol * Math.max(1, Math.abs(half))

    if (err > allow) {
      if (h > hMin && retries < MAX_RETRIES) {
        retries++
        h /= 2
        continue
      }
      // Halving has stopped helping: this is a singularity, not a hard bend.
      // Accepting the step anyway is how an integrator draws a curve through
      // a vertical tangent and out the other side — so don't.
      break
    }
    retries = 0

    const yNext = half + diff / 15
    const xNext = x + sh
    if (!Number.isFinite(yNext) || !Number.isFinite(xNext) || xNext === x) break
    if (Math.abs(yNext) > blowup) break

    x = xNext
    y = yNext
    out.push({ x, y })

    if (err < allow * GROW_MARGIN) h = Math.min(h * 2, hMax)
  }

  return out
}

/**
 * RK4 solution curve of dy/dx = f(x, y) through `through`, across `range`.
 * The result is ordered by increasing x and always contains `through`.
 */
export function solveField(
  f: (x: number, y: number) => number,
  through: Vec2,
  range: [number, number],
  opts?: SolveOpts,
): Vec2[] {
  const lo = Math.min(range[0], range[1])
  const hi = Math.max(range[0], range[1])
  const start: Vec2 = { x: through.x, y: through.y }

  if (!Number.isFinite(start.x) || !Number.isFinite(start.y)) return []
  const width = hi - lo
  if (!(width > 0)) return [start]

  const tol = opts?.tol !== undefined && opts.tol > 0 ? opts.tol : DEFAULT_TOL
  const maxSteps =
    opts?.maxSteps !== undefined && opts.maxSteps > 0 ? Math.floor(opts.maxSteps) : DEFAULT_MAX_STEPS

  // Half the budget backwards; whatever that direction did not spend rolls
  // over, so a curve that stops early one way is not shortchanged the other.
  const half = Math.max(2, Math.ceil(maxSteps / 2))
  const budget: Budget = { left: half }
  const back = start.x > lo ? march(f, start.x, start.y, lo, -1, width, tol, budget) : []
  budget.left += maxSteps - half
  const fwd = start.x < hi ? march(f, start.x, start.y, hi, 1, width, tol, budget) : []

  const pts: Vec2[] = []
  for (let i = back.length - 1; i >= 0; i--) pts.push(back[i])
  pts.push(start)
  for (let i = 0; i < fwd.length; i++) pts.push(fwd[i])

  // Belt and braces: drop anything non-finite or out of order, so the
  // renderer never has to think about it.
  const clean: Vec2[] = []
  for (const p of pts) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
    if (clean.length > 0 && p.x <= clean[clean.length - 1].x) continue
    clean.push(p)
  }
  return clean
}

/**
 * Slopes of dy/dx = f(x, y) on the lattice `xs` x `ys`, row-major: row j is
 * ys[j], column i is xs[i], so the slope at (xs[i], ys[j]) is
 * `out[j * xs.length + i]`. Non-finite slopes come back as NaN, which the
 * renderer draws as "no segment here".
 *
 * One call, one allocation — the field is redrawn on every frame of a slider
 * drag, so there is nothing else in here.
 */
export function sampleField(
  f: (x: number, y: number) => number,
  xs: number[],
  ys: number[],
): Float64Array {
  const nx = xs.length
  const out = new Float64Array(nx * ys.length)
  let k = 0
  for (let j = 0; j < ys.length; j++) {
    const y = ys[j]
    for (let i = 0; i < nx; i++) {
      const s = f(xs[i], y)
      out[k++] = Number.isFinite(s) ? s : NaN
    }
  }
  return out
}

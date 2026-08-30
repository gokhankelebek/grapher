// ============================================================================
// Recognition: fit every plausible model family to a processed stroke and
// return candidates ranked by an AIC-like score (lower = better).
// Residuals are normalized by the stroke's bbox diagonal so the score is
// scale-invariant; per-family penalty weights encode a "familiarity" prior
// (a wobbly hand-drawn line should be a line, not a cubic).
// Never throws: worst case returns a best-effort Fourier / poly3 fallback.
// ============================================================================

import type { ProcessedStroke, Viewport, FitResult, Vec2, CurveKind } from '../types'
import { MODELS } from './models'
import {
  polyfit,
  linearLeastSquares,
  levenbergMarquardt,
  fitCircle,
  fitConic,
  conicGeometricDistance,
} from './optimize'

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

const NOISE_FLOOR = 1e-4 // (1% of bbox diagonal)² — hand jitter we don't reward
const N_EFF = 30         // effective sample count (resampled points correlate)

/** Per-family penalty weight: familiarity prior. Simple, canonical shapes win ties. */
const PENALTY: Record<string, number> = {
  line: 3,
  // A parabola is as canonical as a line or a sinusoid; rating it less familiar
  // than `sine` made their complexity terms tie exactly (2·3·4 == 2·4·3), so
  // hand jitter alone decided every parabola — and a sine hump tracks a
  // parabolic arc to well within it. At parity its lower parameter count wins.
  poly2: 3,
  poly3: 6,
  poly4: 8,
  sine: 3,
  gauss: 3,
  exp: 3,
  abs: 3,
  logistic: 3.5,
  // Roots are as canonical as an exponential or a V, and their fixed exponents
  // make them cheap: they must be able to beat `exp`/`logistic`, which imitate
  // them loosely, on their own shapes.
  sqrt: 3,
  cbrt: 3,
  // A free exponent can imitate poly2 (p=2), abs (p=1) and sqrt (p=1/2), so it
  // is rated far less familiar: at 4 params it needs ~40% lower rms than a
  // fixed-exponent rival to win, which only a genuine odd power achieves.
  power: 4,
  vline: 1,
  circle: 1,
  ellipse: 1.5,
  polarRose: 2,
  limacon: 2,
  spiral: 2,
  fourier: 3,
}

function scoreOf(modelId: string, rmsNorm: number, k: number): number {
  const w = PENALTY[modelId] ?? 3
  return N_EFF * Math.log(rmsNorm * rmsNorm + NOISE_FLOOR) + 2 * k * w
}

// ---------------------------------------------------------------------------
// End trimming
//
// A hand-drawn stroke FLATTENS at both ends: the hand decelerates and the pen
// lifts, so the last few percent of the ink levels off toward horizontal. That
// is an artifact of the hand, not of the shape the user meant — but it is not
// noise, so no amount of smoothing removes it (see the note in stroke.ts), and
// it cannot be undone in stroke processing either: "extrapolate the interior
// trend outward" is precisely the operation that turns a flat-tailed shape
// into a parabola, so it destroys genuine gaussians, V's and logistics.
//
// It has to be handled here, at model selection, because that is the only
// place that knows what the alternatives are. And it matters here: a parabola
// is the one family RIGIDLY required to keep curving, so it is the one family
// a levelled-off tail can disqualify outright. Measured on `0.5x² − 2` over
// [−3, 3], easing the last 12% at each end 30% of the way to horizontal, the
// winner flips from poly2 to sine in 25 seeds out of 25 — the scoring is being
// honest, and honestly wrong about what was drawn.
//
// So: drop the outer END_TRIM of the points at each end before fitting AND
// before measuring the residual — for every family equally, no exceptions and
// no per-family thresholds. The full drawn extent still sets the reported
// domain, and FitResult.error is still measured against every point the user
// drew (see `fullRms` in makeCandidate); only the evidence that decides WHICH
// FAMILY WINS is trimmed.
//
// This works because the two things being told apart live at different
// scales. Pen-lift flattening occupies the last ~12% of a stroke; a gaussian's
// tails, a logistic's plateaus, a sqrt's branch point are the shape's whole
// character and survive any trim that leaves the shape recognizable. Measured
// poly2 rms, 25 seeds, fitted and scored on the trimmed points:
//
//   trim     flattened parabola @30%     genuine gaussian     ratio
//     0%             0.0796                   0.4587           5.8:1
//     8%             0.0252                   0.3930          15.6:1
//    16%             0.0214                   0.2739          12.8:1
//
// Note both halves are needed: trimming the residual while still FITTING on
// the flattened tails barely helps (0.0796 -> 0.0532), because the levelled-off
// ends drag the fitted parabola away from the interior it should be tracking.
//
// THE FRACTION IS CHOSEN FROM THE MISCLASSIFICATION RATE, not from the rms
// separation. 22 explicit shapes x 90 seeds x flattening in {0, 15%, 30%}
// (5940 strokes), and the same at an extreme 60%:
//
//   trim      0%     4%     5%     6%     7%     8%    10%
//   0/15/30  570      0      0      0      0      2     36     (of 5940)
//   60%      996     29      9      4      4      5     21     (of 1980)
//
// 4–7% all classify the target range perfectly; 6–7% also minimize the extreme
// case. 6% is the interior of that window — the value furthest from BOTH
// failure modes. Below ~4% the artifact survives and parabolas lose to sine;
// above ~8% the trim starts eating evidence that genuinely lives at an end,
// and `power` (whose exponent is pinned by the outer reach) and `sqrt` (whose
// branch point IS an endpoint) begin to lose to their imitators.
//
// Closed strokes are NOT trimmed. Their endpoints coincide, so there is no
// dangling tail to discount — the "ends" land in the middle of a genuine arc,
// and cutting them would delete real shape rather than an artifact.
const END_TRIM = 0.06
const MIN_CORE_POINTS = 12

/** The interior of an open stroke: the ink minus the pen-lift band at each end. */
function trimEnds(pts: Vec2[], frac: number): Vec2[] {
  const n = pts.length
  const k = Math.floor(n * frac)
  if (k < 1 || n - 2 * k < MIN_CORE_POINTS) return pts
  return pts.slice(k, n - k)
}

interface Candidate extends FitResult { }

function makeCandidate(
  modelId: string,
  params: number[],
  kind: CurveKind,
  domain: [number, number] | null,
  rms: number,
  diag: number,
  k: number,
  fullRms?: number,
): Candidate | null {
  if (!params.every(Number.isFinite) || !Number.isFinite(rms)) return null
  const rmsNorm = rms / diag
  // `score` ranks families on the trimmed interior; `error` is the σ the UI
  // shows, so it is measured against ALL the ink — a sigma that quietly
  // excluded part of the user's stroke would be its own small lie.
  const reported = fullRms !== undefined && Number.isFinite(fullRms) ? fullRms : rms
  return { modelId, params, kind, domain, error: reported, score: scoreOf(modelId, rmsNorm, k) }
}

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

function mean(v: number[]): number {
  let s = 0
  for (const x of v) s += x
  return v.length ? s / v.length : 0
}

function rmsOf(residuals: number[]): number {
  let s = 0
  for (const r of residuals) s += r * r
  return residuals.length ? Math.sqrt(s / residuals.length) : Infinity
}

function wrapPi(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI
  while (a < -Math.PI) a += 2 * Math.PI
  return a
}

// ---------------------------------------------------------------------------
// Explicit-family fitting
// ---------------------------------------------------------------------------

function rmsExplicit(pts: Vec2[], f: (x: number) => number): number {
  const res: number[] = []
  for (const p of pts) {
    const v = p.y - f(p.x)
    res.push(Number.isFinite(v) ? v : 1e6)
  }
  return rmsOf(res)
}

function lmRefineExplicit(
  pts: Vec2[],
  evalF: (p: number[], x: number) => number,
  p0: number[],
): { params: number[]; rms: number } | null {
  const residuals = (p: number[]) => pts.map(pt => pt.y - evalF(p, pt.x))
  const out = levenbergMarquardt(residuals, p0, 100)
  if (!out) return null
  return { params: out.params, rms: Math.sqrt(out.rss / pts.length) }
}

function fitPolyFamily(pts: Vec2[], degree: number): { params: number[]; rms: number } | null {
  const xs = pts.map(p => p.x)
  const ys = pts.map(p => p.y)
  const c = polyfit(xs, ys, degree)
  if (!c) return null
  return { params: c, rms: rmsExplicit(pts, x => hornerEval(c, x)) }
}

function hornerEval(c: number[], x: number): number {
  let v = 0
  for (let i = c.length - 1; i >= 0; i--) v = v * x + c[i]
  return v
}

/** Sine: frequency seeded from zero crossings of detrended data, phase/amp/offset
 *  from a linear solve at each candidate frequency, then LM refinement. */
function fitSine(pts: Vec2[]): { params: number[]; rms: number } | null {
  const xs = pts.map(p => p.x)
  const ys = pts.map(p => p.y)
  const n = pts.length
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  const L = xMax - xMin
  if (!(L > 0)) return null

  const lin = polyfit(xs, ys, 1)
  const det = ys.map((y, i) => y - (lin ? lin[0] + lin[1] * xs[i] : mean(ys)))
  let dMax = -Infinity, dMin = Infinity
  for (const v of det) { if (v > dMax) dMax = v; if (v < dMin) dMin = v }
  const amp0 = (dMax - dMin) / 2
  if (!(amp0 > 0)) return null

  // hysteresis zero-crossing count
  let lastSign = 0
  let crossings = 0
  for (const v of det) {
    if (Math.abs(v) < 0.15 * amp0) continue
    const s = v > 0 ? 1 : -1
    if (lastSign !== 0 && s !== lastSign) crossings++
    lastSign = s
  }
  const b0 = (Math.PI * Math.max(crossings, 1)) / L

  let best: { params: number[]; rss: number } | null = null
  for (const f of [0.5, 0.75, 1, 1.25, 1.5, 2]) {
    const b = b0 * f
    if (!(b > 0)) continue
    // y ≈ d + p·sin(bx) + q·cos(bx), linear in [d, p, q]
    const rows = xs.map(x => [1, Math.sin(b * x), Math.cos(b * x)])
    const sol = linearLeastSquares(rows, ys)
    if (!sol) continue
    const [d, pC, qC] = sol
    let rss = 0
    for (let i = 0; i < n; i++) {
      const r = ys[i] - (d + pC * Math.sin(b * xs[i]) + qC * Math.cos(b * xs[i]))
      rss += r * r
    }
    const a = Math.hypot(pC, qC)
    const c = Math.atan2(qC, pC)
    if (!best || rss < best.rss) best = { params: [a, b, c, d], rss }
  }
  if (!best) return null
  const spec = MODELS.sine
  const refined = spec.evalExplicit
    ? lmRefineExplicit(pts, spec.evalExplicit.bind(spec), best.params)
    : null
  if (refined && refined.rms <= Math.sqrt(best.rss / n)) return refined
  return { params: best.params, rms: Math.sqrt(best.rss / n) }
}

function fitGauss(pts: Vec2[]): { params: number[]; rms: number } | null {
  const ys = pts.map(p => p.y)
  const n = pts.length
  const edge = Math.max(3, Math.floor(n / 10))
  const baseline =
    (mean(ys.slice(0, edge)) + mean(ys.slice(n - edge))) / 2
  // extremum farthest from the baseline (peak up or dip down)
  let idx = 0
  let bestDev = -Infinity
  for (let i = 0; i < n; i++) {
    const dev = Math.abs(ys[i] - baseline)
    if (dev > bestDev) { bestDev = dev; idx = i }
  }
  const a0 = ys[idx] - baseline
  if (Math.abs(a0) < 1e-12) return null
  const b0 = pts[idx].x
  // half-width at half max
  const half = baseline + a0 / 2
  let left = pts[0].x, right = pts[n - 1].x
  for (let i = idx; i >= 0; i--) {
    if ((ys[i] - half) * Math.sign(a0) <= 0) { left = pts[i].x; break }
  }
  for (let i = idx; i < n; i++) {
    if ((ys[i] - half) * Math.sign(a0) <= 0) { right = pts[i].x; break }
  }
  const xRange = Math.abs(pts[n - 1].x - pts[0].x)
  let hwhm = Math.max(Math.abs(right - b0), Math.abs(b0 - left))
  if (!(hwhm > 0)) hwhm = xRange / 6
  const c0 = Math.max(hwhm / 0.8326, xRange / 50)
  const spec = MODELS.gauss
  if (!spec.evalExplicit) return null
  const fit = lmRefineExplicit(pts, spec.evalExplicit.bind(spec), [a0, b0, c0, baseline])
  if (!fit) return null
  // plausibility: reject degenerate "bells" that merely mimic low-order polys
  // (huge width / amplitude with the peak far outside the drawn range)
  let yMin = Infinity, yMax = -Infinity
  for (const y of ys) { if (y < yMin) yMin = y; if (y > yMax) yMax = y }
  const yRange = Math.max(yMax - yMin, 1e-12)
  const [aF, bF, cF] = fit.params
  const xMid = (pts[0].x + pts[n - 1].x) / 2
  if (Math.abs(cF) > 1.5 * xRange) return null
  if (Math.abs(aF) > 10 * yRange) return null
  if (Math.abs(bF - xMid) > xRange) return null
  return fit
}

function fitExp(pts: Vec2[]): { params: number[]; rms: number } | null {
  const xs = pts.map(p => p.x)
  const ys = pts.map(p => p.y)
  let yMin = Infinity, yMax = -Infinity
  for (const y of ys) { if (y < yMin) yMin = y; if (y > yMax) yMax = y }
  const range = yMax - yMin
  if (!(range > 0)) return null
  const spec = MODELS.exp
  if (!spec.evalExplicit) return null
  const ev = spec.evalExplicit.bind(spec)

  let best: { params: number[]; rms: number } | null = null
  // orientation 1: y = a e^{bx} + c with a > 0 (curve above asymptote c)
  // orientation 2: y = a e^{bx} + c with a < 0 (curve below asymptote c)
  for (const flip of [false, true]) {
    const c0 = flip ? yMax + 0.05 * range : yMin - 0.05 * range
    const z = ys.map(y => (flip ? c0 - y : y - c0))
    if (z.some(v => !(v > 0))) continue
    const rows = xs.map(x => [1, x])
    const sol = linearLeastSquares(rows, z.map(Math.log))
    if (!sol) continue
    const a0 = (flip ? -1 : 1) * Math.exp(sol[0])
    const b0 = sol[1]
    const refined = lmRefineExplicit(pts, ev, [a0, b0, c0])
    if (refined && (!best || refined.rms < best.rms)) best = refined
  }
  return best
}

function fitAbs(pts: Vec2[]): { params: number[]; rms: number } | null {
  const ys = pts.map(p => p.y)
  const n = pts.length
  // kink at the y-extremum farthest from the chord between endpoints
  let idx = 0
  let bestDev = -Infinity
  const y0 = ys[0], y1 = ys[n - 1]
  const x0 = pts[0].x, x1 = pts[n - 1].x
  const denom = x1 - x0 || 1
  for (let i = 0; i < n; i++) {
    const chord = y0 + ((pts[i].x - x0) / denom) * (y1 - y0)
    const dev = Math.abs(ys[i] - chord)
    if (dev > bestDev) { bestDev = dev; idx = i }
  }
  const b0 = pts[idx].x
  const c0 = ys[idx]
  const spanL = Math.abs(b0 - x0), spanR = Math.abs(x1 - b0)
  const slope =
    spanR > spanL ? (y1 - c0) / (x1 - b0 || 1) : (y0 - c0) / (x0 - b0 || 1)
  const a0 = Number.isFinite(slope) && slope !== 0 ? slope : 1
  const spec = MODELS.abs
  if (!spec.evalExplicit) return null
  return lmRefineExplicit(pts, spec.evalExplicit.bind(spec), [a0, b0, c0])
}

/**
 * Root/power families share one trick: with the branch point b fixed, the model
 * y = a·g(x − b) + c is LINEAR in (a, c). So sweep b over a grid, solve (a, c)
 * exactly at each, keep the best, then polish all parameters with LM. Far more
 * reliable than linearizing (y − c)² = a²(x − b), which needs c up front.
 */
function fitByBranchPoint(
  pts: Vec2[],
  g: (u: number) => number,
  bGrid: number[],
  evalF: (p: number[], x: number) => number,
): { params: number[]; rms: number } | null {
  const n = pts.length
  let best: { params: number[]; rss: number } | null = null
  for (const b of bGrid) {
    const rows: number[][] = []
    const ys: number[] = []
    let ok = true
    for (const pt of pts) {
      const u = g(pt.x - b)
      if (!Number.isFinite(u)) { ok = false; break }
      rows.push([u, 1])
      ys.push(pt.y)
    }
    if (!ok) continue
    const sol = linearLeastSquares(rows, ys)
    if (!sol) continue
    const [a, c] = sol
    if (!Number.isFinite(a) || !Number.isFinite(c)) continue
    let rss = 0
    for (let i = 0; i < n; i++) {
      const r = pts[i].y - (a * rows[i][0] + c)
      rss += r * r
    }
    if (Number.isFinite(rss) && (!best || rss < best.rss)) best = { params: [a, b, c], rss }
  }
  if (!best) return null
  const refined = lmRefineExplicit(pts, evalF, best.params)
  const coarse = { params: best.params, rms: Math.sqrt(best.rss / n) }
  if (refined && Number.isFinite(refined.rms) && refined.rms <= coarse.rms) return refined
  return coarse
}

/**
 * y = a·sqrt(x − b) + c. The branch point sits at or left of the drawn ink.
 * `inkMinX` is the left edge of the WHOLE stroke, which may lie left of `pts`
 * when the ends have been trimmed: b must clear all the ink, not just the
 * points being fitted, or the reported domain would cut off part of the
 * stroke and the σ measured over it would be infinite.
 */
function fitSqrt(pts: Vec2[], inkMinX: number): { params: number[]; rms: number } | null {
  const n = pts.length
  if (n < 4) return null
  let minX = Infinity, maxX = -Infinity
  for (const p of pts) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x }
  const w = maxX - minX
  if (!(w > 0)) return null
  // b ranges from a full stroke-width left of the fitted points up to the left
  // edge of the ink. When the ends are trimmed that upper bound sits inside
  // the discarded head — which is exactly right: for a square root the branch
  // point IS the endpoint, so it belongs in the band we stopped scoring, not
  // at the first point we kept.
  const bMax = Math.min(minX + 0.02 * w, inkMinX)
  const grid: number[] = []
  const STEPS = 48
  const lo = minX - w
  const hi = bMax
  for (let i = 0; i <= STEPS; i++) {
    // denser near the left end, where the interesting branch points live
    const u = i / STEPS
    grid.push(hi - (hi - lo) * u * u)
  }
  const spec = MODELS.sqrt
  if (!spec.evalExplicit) return null
  const ev = spec.evalExplicit.bind(spec)
  const fit = fitByBranchPoint(
    pts,
    u => (u < 0 ? Number.NaN : Math.sqrt(u)),
    grid,
    // LM must see a finite residual surface: clamp instead of NaN while fitting
    (p, x) => p[0] * Math.sqrt(Math.max(x - p[1], 0)) + p[2],
  )
  if (!fit) return null
  let [a, b, c] = fit.params
  // The branch point must sit at or left of the ink, or part of the stroke
  // falls outside the curve's own domain. LM can nudge b a hair inside while
  // chasing jitter, so clamp it back and re-solve (a, c) exactly there.
  if (b > bMax) {
    b = bMax
    const rows: number[][] = []
    for (const pt of pts) rows.push([Math.sqrt(Math.max(pt.x - b, 0)), 1])
    const sol = linearLeastSquares(rows, pts.map(pt => pt.y))
    if (!sol) return null
    a = sol[0]
    c = sol[1]
  }
  const params = [a, b, c]
  // now every ink x is ≥ b, so the true (NaN-outside) evaluator is finite
  const rms = rmsExplicit(pts, x => ev(params, x))
  if (!Number.isFinite(rms)) return null
  return { params, rms }
}

/** y = a·cbrt(x − b) + c — defined everywhere, inflection at the branch point. */
function fitCbrt(pts: Vec2[]): { params: number[]; rms: number } | null {
  const n = pts.length
  if (n < 4) return null
  let minX = Infinity, maxX = -Infinity
  for (const p of pts) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x }
  const w = maxX - minX
  if (!(w > 0)) return null
  // What makes a curve a CUBE root rather than a generic concave arc is the odd
  // inflection at the branch point: the curve turns over there. If b falls
  // outside the drawn span that signature was never drawn, and the ink is
  // really a one-sided root — sqrt/power territory. So keep b inside the ink.
  const margin = 0.1 * w
  const lo = minX - margin
  const hi = maxX + margin
  const grid: number[] = []
  const STEPS = 60
  for (let i = 0; i <= STEPS; i++) grid.push(lo + ((hi - lo) * i) / STEPS)
  const spec = MODELS.cbrt
  if (!spec.evalExplicit) return null
  const fit = fitByBranchPoint(pts, u => Math.cbrt(u), grid, spec.evalExplicit.bind(spec))
  if (!fit) return null
  const b = fit.params[1]
  if (b < lo || b > hi) return null
  // and the inflection must actually have been DRAWN: with the branch point at
  // the edge of the ink only one arm exists, which every root family fits
  // equally well — the cube root has no claim there.
  let left = 0
  for (const p of pts) if (p.x < b) left++
  const leftFrac = left / n
  if (leftFrac < 0.15 || leftFrac > 0.85) return null
  return fit
}

/**
 * y = a·|x − b|^p + c with the exponent fitted. Powerful but imitative — it can
 * mimic a parabola (p = 2), a V (p = 1) or a square root (p = 1/2), so it is
 * scored with a much heavier complexity penalty and only reported when it is
 * decisively better than the fixed-exponent families.
 */
function fitPower(pts: Vec2[]): { params: number[]; rms: number } | null {
  const n = pts.length
  if (n < 5) return null
  let minX = Infinity, maxX = -Infinity
  for (const p of pts) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x }
  const w = maxX - minX
  if (!(w > 0)) return null
  const spec = MODELS.power
  if (!spec.evalExplicit) return null
  const ev = spec.evalExplicit.bind(spec)

  // coarse 2-D sweep over (b, p); (a, c) stay exact by linear solve
  const bs: number[] = []
  for (let i = 0; i <= 40; i++) bs.push(minX - 0.6 * w + (2.2 * w * i) / 40)
  const ps = [0.2, 0.25, 1 / 3, 0.4, 0.5, 2 / 3, 0.75, 1.25, 1.5, 1.75, 2, 2.5, 3]
  let best: { params: number[]; rss: number } | null = null
  for (const pExp of ps) {
    for (const b of bs) {
      const rows: number[][] = []
      for (const pt of pts) rows.push([Math.pow(Math.abs(pt.x - b), pExp), 1])
      const sol = linearLeastSquares(rows, pts.map(pt => pt.y))
      if (!sol) continue
      let rss = 0
      for (let i = 0; i < n; i++) {
        const r = pts[i].y - (sol[0] * rows[i][0] + sol[1])
        rss += r * r
      }
      if (Number.isFinite(rss) && (!best || rss < best.rss)) {
        best = { params: [sol[0], b, sol[1], pExp], rss }
      }
    }
  }
  if (!best) return null
  const refined = lmRefineExplicit(pts, ev, best.params)
  const chosen =
    refined && Number.isFinite(refined.rms) && refined.rms <= Math.sqrt(best.rss / n)
      ? refined
      : { params: best.params, rms: Math.sqrt(best.rss / n) }
  const pExp = chosen.params[3]
  // keep the exponent in a sane band, and away from 1 (that is a line or a V)
  if (!(pExp > 0.12 && pExp < 4)) return null
  if (Math.abs(pExp - 1) < 0.06) return null
  return chosen
}

function fitLogistic(pts: Vec2[]): { params: number[]; rms: number } | null {
  const ys = pts.map(p => p.y)
  const n = pts.length
  const edge = Math.max(3, Math.floor(n / 10))
  const yStart = mean(ys.slice(0, edge))
  const yEnd = mean(ys.slice(n - edge))
  const a0 = yEnd - yStart
  if (Math.abs(a0) < 1e-12) return null
  const d0 = yStart
  // steepest slope location
  let idx = Math.floor(n / 2)
  let bestSlope = 0
  for (let i = 1; i < n - 1; i++) {
    const dx = pts[i + 1].x - pts[i - 1].x
    if (Math.abs(dx) < 1e-12) continue
    const s = (ys[i + 1] - ys[i - 1]) / dx
    if (Math.abs(s) > Math.abs(bestSlope)) { bestSlope = s; idx = i }
  }
  const c0 = pts[idx].x
  const b0 = Math.abs(bestSlope) > 1e-12 ? (4 * bestSlope) / a0 : 1
  const spec = MODELS.logistic
  if (!spec.evalExplicit) return null
  return lmRefineExplicit(pts, spec.evalExplicit.bind(spec), [a0, Math.abs(b0), c0, d0])
}

// ---------------------------------------------------------------------------
// Fourier fitting (closed curves; open curves are mirrored into closed ones)
// ---------------------------------------------------------------------------

function fitFourier(
  pts: Vec2[],
  closed: boolean,
  diag: number,
  maxN = 12,
): { params: number[]; rms: number; N: number } | null {
  let P = pts
  if (!closed) {
    // mirror trick: forward + reversed interior => an even (cosine-only) closed
    // path that traces the open stroke there and back.
    const back: Vec2[] = []
    for (let i = pts.length - 2; i >= 1; i--) back.push(pts[i])
    P = pts.concat(back)
  }
  const M = P.length
  if (M < 8) return null
  const ts = new Array<number>(M)
  for (let i = 0; i < M; i++) ts[i] = (2 * Math.PI * i) / M

  const cx = mean(P.map(p => p.x))
  const cy = mean(P.map(p => p.y))

  // precompute all harmonics up to maxN
  const coeffs: number[][] = [] // per harmonic: [ax, bx, ay, by]
  for (let nH = 1; nH <= maxN; nH++) {
    let ax = 0, bx = 0, ay = 0, by = 0
    for (let i = 0; i < M; i++) {
      const cn = Math.cos(nH * ts[i])
      const sn = Math.sin(nH * ts[i])
      ax += (P[i].x - cx) * cn
      bx += (P[i].x - cx) * sn
      ay += (P[i].y - cy) * cn
      by += (P[i].y - cy) * sn
    }
    coeffs.push([(2 * ax) / M, (2 * bx) / M, (2 * ay) / M, (2 * by) / M])
  }

  const evalAt = (N: number, t: number): Vec2 => {
    let x = cx, y = cy
    for (let nH = 1; nH <= N; nH++) {
      const [ax, bx, ay, by] = coeffs[nH - 1]
      const cn = Math.cos(nH * t)
      const sn = Math.sin(nH * t)
      x += ax * cn + bx * sn
      y += ay * cn + by * sn
    }
    return { x, y }
  }

  let chosenN = maxN
  let chosenRms = Infinity
  for (let N = 1; N <= maxN; N++) {
    let ss = 0
    for (let i = 0; i < M; i++) {
      const q = evalAt(N, ts[i])
      const dx = P[i].x - q.x
      const dy = P[i].y - q.y
      ss += dx * dx + dy * dy
    }
    const rms = Math.sqrt(ss / M)
    if (rms < 0.01 * diag || N === maxN) {
      chosenN = N
      chosenRms = rms
      break
    }
    chosenRms = rms
  }

  const params: number[] = [cx, cy]
  for (let nH = 1; nH <= chosenN; nH++) params.push(...coeffs[nH - 1])
  return { params, rms: chosenRms, N: chosenN }
}

// ---------------------------------------------------------------------------
// Polar analysis
// ---------------------------------------------------------------------------

interface PolarSamples {
  theta: number[]       // unwrapped angles about the origin
  thetaRaw: number[]    // wrapped atan2 angles
  r: number[]
  sweep: number         // total swept angle (signed sum of trusted increments)
  monoFrac: number      // fraction of steps turning in the dominant direction
  coverage: number      // fraction of the 16 direction bins visited
  originDips: number    // separate passes near the origin (petal signature)
}

function polarSamples(pts: Vec2[], diag: number): PolarSamples | null {
  const n = pts.length
  if (n < 8) return null
  const thetaRaw = new Array<number>(n)
  const r = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    r[i] = Math.hypot(pts[i].x, pts[i].y)
    thetaRaw[i] = Math.atan2(pts[i].y, pts[i].x)
  }
  const theta = new Array<number>(n)
  theta[0] = thetaRaw[0]
  let sweep = 0
  let pos = 0, neg = 0, counted = 0
  const rMin = 0.03 * diag
  for (let i = 1; i < n; i++) {
    const d = wrapPi(thetaRaw[i] - thetaRaw[i - 1])
    theta[i] = theta[i - 1] + d
    // only trust increments away from the origin and free of ±π ambiguity
    // (curves through the origin — roses — flip angle by ~π between petals)
    if (r[i] > rMin && r[i - 1] > rMin && Math.abs(d) < Math.PI / 2) {
      sweep += d
      counted++
      if (d > 0) pos++
      else if (d < 0) neg++
    }
  }
  const monoFrac = counted > 0 ? Math.max(pos, neg) / counted : 0
  // direction-bin coverage: roses pass through the origin, so their trusted
  // sweep stays small even though the ink surrounds the origin
  const BINS = 16
  const seen = new Array<boolean>(BINS).fill(false)
  for (let i = 0; i < n; i++) {
    if (r[i] > rMin) {
      const b = Math.floor(((thetaRaw[i] + Math.PI) / (2 * Math.PI)) * BINS) % BINS
      seen[b] = true
    }
  }
  let visited = 0
  for (const s of seen) if (s) visited++

  // petal signature: count separate dips of r toward the origin. A pen tracing
  // a rose (or an inner-loop limaçon) passes near r≈0 repeatedly.
  let rMax = 0
  for (const v of r) if (v > rMax) rMax = v
  const dipThresh = 0.12 * rMax
  let originDips = 0
  let inDip = r[0] < dipThresh
  let startedInDip = inDip
  for (let i = 1; i < n; i++) {
    const below = r[i] < dipThresh
    if (below && !inDip) originDips++
    inDip = below
  }
  if (startedInDip) originDips++ // the run the stroke started inside
  // a closed stroke that both starts and ends in the same dip counts it twice
  if (startedInDip && r[n - 1] < dipThresh && originDips > 1) originDips--

  return { theta, thetaRaw, r, sweep, monoFrac, coverage: visited / BINS, originDips }
}

/** rms of true geometric distances from the samples to the rose curve
 *  r = a·cos(kθ + c), measured against a dense polyline (segment projection).
 *  The radial residual overestimates error badly near petal boundaries
 *  (|dr/dφ| ≈ a·k there), so σ must be geometric to sit at the noise floor. */
function roseGeometricRms(ps: PolarSamples, a: number, k: number, c: number): number {
  const S = 360
  const cx = new Array<number>(S)
  const cy = new Array<number>(S)
  for (let j = 0; j < S; j++) {
    const th = (2 * Math.PI * j) / S
    const r = a * Math.cos(k * th + c)
    cx[j] = r * Math.cos(th)
    cy[j] = r * Math.sin(th)
  }
  let ss = 0
  const n = ps.r.length
  for (let i = 0; i < n; i++) {
    const px = ps.r[i] * Math.cos(ps.thetaRaw[i])
    const py = ps.r[i] * Math.sin(ps.thetaRaw[i])
    let best = Infinity
    for (let j = 0; j < S; j++) {
      const j2 = (j + 1) % S
      const ax = cx[j], ay = cy[j]
      const bx = cx[j2] - ax, by = cy[j2] - ay
      const len2 = bx * bx + by * by
      let t = len2 > 1e-18 ? ((px - ax) * bx + (py - ay) * by) / len2 : 0
      if (t < 0) t = 0
      else if (t > 1) t = 1
      const dx = px - (ax + t * bx)
      const dy = py - (ay + t * by)
      const dd = dx * dx + dy * dy
      if (dd < best) best = dd
    }
    ss += best
  }
  return Math.sqrt(ss / n)
}

/**
 * Rose r = a·cos(kθ + c), signed-r drawing convention: a pen point measured at
 * (r, φ) lies on the curve iff r = |A(φ)| with A(φ) = p·cos(kφ) + q·sin(kφ)
 * (the (−r, θ+π) branch folds into the absolute value for every k).
 * Fit (p, q) per k by alternating-sign least squares seeded from a phase grid,
 * then refine robustly (Huber IRLS) so noisy petal-boundary points don't bias
 * amplitude/phase; arbitrarily rotated hand-drawn roses fit exactly.
 */
function fitRose(ps: PolarSamples): { params: number[]; rms: number } | null {
  const M = ps.r.length
  let best: { params: number[]; rms: number } | null = null
  for (let k = 1; k <= 8; k++) {
    const ck = new Array<number>(M)
    const sk = new Array<number>(M)
    for (let i = 0; i < M; i++) {
      ck[i] = Math.cos(k * ps.thetaRaw[i])
      sk[i] = Math.sin(k * ps.thetaRaw[i])
    }
    const SEEDS = 6
    let bestPQ: { p: number; q: number; rms: number } | null = null
    for (let s = 0; s < SEEDS; s++) {
      const c0 = (s * Math.PI) / (k * SEEDS) // petal pattern has period π/k
      let signs: number[] = []
      for (let i = 0; i < M; i++) {
        signs.push(Math.cos(k * ps.thetaRaw[i] + c0) >= 0 ? 1 : -1)
      }
      let pq: number[] | null = null
      for (let it = 0; it < 4; it++) {
        const rows: number[][] = []
        const ys: number[] = []
        for (let i = 0; i < M; i++) {
          rows.push([ck[i], sk[i]])
          ys.push(signs[i] * ps.r[i])
        }
        pq = linearLeastSquares(rows, ys)
        if (!pq) break
        let changed = false
        const next: number[] = []
        for (let i = 0; i < M; i++) {
          const t = pq[0] * ck[i] + pq[1] * sk[i] >= 0 ? 1 : -1
          if (t !== signs[i]) changed = true
          next.push(t)
        }
        signs = next
        if (!changed) break
      }
      if (!pq) continue
      const res: number[] = []
      for (let i = 0; i < M; i++) {
        const e = Math.abs(ps.r[i] - Math.abs(pq[0] * ck[i] + pq[1] * sk[i]))
        // the rose passes through the origin, so no point is farther from the
        // curve than its own radius (protects smoothing-rounded origin passes)
        res.push(Math.min(e, ps.r[i]))
      }
      const rms = rmsOf(res)
      if (!bestPQ || rms < bestPQ.rms) bestPQ = { p: pq[0], q: pq[1], rms }
    }
    if (!bestPQ) continue

    // Huber IRLS refinement: petal-boundary points carry large radial residual
    // under jitter (steep |dr/dφ|); downweighting them un-biases (p, q).
    for (let it = 0; it < 3; it++) {
      const abs: number[] = []
      const e: number[] = []
      const sg: number[] = []
      for (let i = 0; i < M; i++) {
        const A = bestPQ.p * ck[i] + bestPQ.q * sk[i]
        const s = A >= 0 ? 1 : -1
        const ei = s * ps.r[i] - A
        sg.push(s)
        e.push(ei)
        abs.push(Math.abs(ei))
      }
      const sortedAbs = abs.slice().sort((x, y) => x - y)
      const delta = 1.5 * sortedAbs[Math.floor(M / 2)] + 1e-9
      const rows: number[][] = []
      const ys: number[] = []
      for (let i = 0; i < M; i++) {
        const wH = Math.sqrt(Math.min(1, delta / (abs[i] + 1e-12)))
        rows.push([ck[i] * wH, sk[i] * wH])
        ys.push(sg[i] * ps.r[i] * wH)
      }
      const pq2 = linearLeastSquares(rows, ys)
      if (!pq2) break
      bestPQ.p = pq2[0]
      bestPQ.q = pq2[1]
    }
    // clamped radial rms only ranks k; σ is computed geometrically below
    {
      const res: number[] = []
      for (let i = 0; i < M; i++) {
        const e = Math.abs(ps.r[i] - Math.abs(bestPQ.p * ck[i] + bestPQ.q * sk[i]))
        res.push(Math.min(e, ps.r[i]))
      }
      bestPQ.rms = rmsOf(res)
    }

    const a = Math.hypot(bestPQ.p, bestPQ.q)
    if (!(a > 1e-12)) continue
    const c = Math.atan2(-bestPQ.q, bestPQ.p) // A(φ) = a·cos(kφ + c)
    if (!best || bestPQ.rms < best.rms) best = { params: [a, k, c], rms: bestPQ.rms }
  }
  if (!best) return null
  // The |A| fit fixes c only up to π: c and c+π yield the same measured radii
  // but render complementary petal sets for odd k. Pick the sign whose actual
  // rendered curve hugs the ink, and report that honest geometric error.
  const [a0, kBest, c0] = [best.params[0], Math.round(best.params[1]), best.params[2]]
  const wrap = (v: number) => {
    let x = v
    while (x > Math.PI) x -= TWO_PI_R
    while (x <= -Math.PI) x += TWO_PI_R
    return x
  }
  const rms1 = roseGeometricRms(ps, a0, kBest, wrap(c0))
  const rms2 = roseGeometricRms(ps, a0, kBest, wrap(c0 + Math.PI))
  if (rms2 < rms1) {
    best.params[2] = wrap(c0 + Math.PI)
    best.rms = rms2
  } else {
    best.params[2] = wrap(c0)
    best.rms = rms1
  }
  return best
}

const TWO_PI_R = 2 * Math.PI

/**
 * Limaçon r = a + b·cos(θ) with signed-r support: a measured point (r, φ)
 * matches either r = a + b·cosφ (outer) or r = −a + b·cosφ (inner loop,
 * i.e. the (−r, θ+π) branch). Alternating ±a least squares.
 */
function fitLimacon(ps: PolarSamples): { params: number[]; rms: number } | null {
  const M = ps.r.length
  const cth = ps.thetaRaw.map(Math.cos)
  let signs: number[] = new Array<number>(M).fill(1)
  let sol: number[] | null = null
  for (let it = 0; it < 5; it++) {
    const rows: number[][] = []
    for (let i = 0; i < M; i++) rows.push([signs[i], cth[i]])
    sol = linearLeastSquares(rows, ps.r)
    if (!sol) return null
    let changed = false
    const next: number[] = []
    for (let i = 0; i < M; i++) {
      const ePlus = Math.abs(ps.r[i] - (sol[0] + sol[1] * cth[i]))
      const eMinus = Math.abs(ps.r[i] - (-sol[0] + sol[1] * cth[i]))
      const t = eMinus < ePlus ? -1 : 1
      if (t !== signs[i]) changed = true
      next.push(t)
    }
    signs = next
    if (!changed) break
  }
  if (!sol) return null
  const [a, b] = sol
  // distance from origin to the curve (0 when the limaçon has an inner loop)
  const dOrigin = Math.max(Math.abs(a) - Math.abs(b), 0)
  const res: number[] = []
  for (let i = 0; i < M; i++) {
    const ePlus = Math.abs(ps.r[i] - (a + b * cth[i]))
    const eMinus = Math.abs(ps.r[i] - (-a + b * cth[i]))
    res.push(Math.min(ePlus, eMinus, ps.r[i] + dOrigin))
  }
  return { params: [a, b], rms: rmsOf(res) }
}

function fitSpiral(ps: PolarSamples): { params: number[]; rms: number } | null {
  const rows = ps.theta.map(t => [1, t])
  const sol = linearLeastSquares(rows, ps.r)
  if (!sol) return null
  const res = ps.r.map((r, i) => r - (sol[0] + sol[1] * ps.theta[i]))
  return { params: [sol[0], sol[1]], rms: rmsOf(res) }
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export function recognize(stroke: ProcessedStroke, vp: Viewport): FitResult[] {
  void vp
  const candidates: FitResult[] = []
  try {
    recognizeInto(stroke, candidates)
  } catch {
    // fall through to the fallback below
  }
  if (candidates.length === 0) {
    try {
      addFallback(stroke, candidates)
    } catch {
      /* truly nothing fits */
    }
  }
  candidates.sort((a, b) => a.score - b.score)
  return candidates
}

function recognizeInto(stroke: ProcessedStroke, out: FitResult[]): void {
  const pts = stroke.points
  const n = pts.length
  if (n < 8) {
    addFallback(stroke, out)
    return
  }
  const width = stroke.bbox.max.x - stroke.bbox.min.x
  const height = stroke.bbox.max.y - stroke.bbox.min.y
  const diag = Math.max(Math.hypot(width, height), 1e-9)

  // The interior of the stroke — the evidence that decides the family. The
  // bbox, the domain and the reported σ all still come from the full ink.
  const core = stroke.closed ? pts : trimEnds(pts, END_TRIM)

  const push = (c: FitResult | null) => { if (c) out.push(c) }

  /** σ of a fitted explicit family measured over EVERY drawn point. */
  const fullRmsOf = (id: string, params: number[]): number | undefined => {
    const ev = MODELS[id]?.evalExplicit
    if (!ev) return undefined
    return rmsExplicit(pts, x => ev(params, x))
  }

  // ---- nearly vertical stroke -> x = a --------------------------------------
  if (height > 0 && width < 0.06 * height && !stroke.closed) {
    const a = mean(core.map(p => p.x))
    const rms = rmsOf(core.map(p => p.x - a))
    const fullRms = rmsOf(pts.map(p => p.x - a))
    const padY = 0.05 * height
    push(
      makeCandidate('vline', [a], 'parametric',
        [stroke.bbox.min.y - padY, stroke.bbox.max.y + padY], rms, diag, 1, fullRms),
    )
  }

  // ---- open, single-valued in x -> explicit families ------------------------
  if (!stroke.closed && !stroke.multiValuedX && width > 1e-12) {
    const padX = 0.05 * width
    const domain: [number, number] = [stroke.bbox.min.x - padX, stroke.bbox.max.x + padX]

    const polyIds = ['line', 'poly2', 'poly3', 'poly4'] as const
    for (let d = 1; d <= 4; d++) {
      try {
        const fit = fitPolyFamily(core, d)
        const id = polyIds[d - 1]
        if (fit) {
          push(makeCandidate(id, fit.params, 'explicit', domain, fit.rms, diag, d + 1,
            rmsExplicit(pts, x => hornerEval(fit.params, x))))
        }
      } catch { /* skip */ }
    }

    const nonlinear: Array<[string, () => { params: number[]; rms: number } | null, number]> = [
      ['sine', () => fitSine(core), 4],
      ['gauss', () => fitGauss(core), 4],
      ['exp', () => fitExp(core), 3],
      ['abs', () => fitAbs(core), 3],
      ['logistic', () => fitLogistic(core), 4],
      ['cbrt', () => fitCbrt(core), 3],
      ['power', () => fitPower(core), 4],
    ]
    for (const [id, fitFn, k] of nonlinear) {
      try {
        const fit = fitFn()
        if (fit) {
          push(makeCandidate(id, fit.params, 'explicit', domain, fit.rms, diag, k,
            fullRmsOf(id, fit.params)))
        }
      } catch { /* skip */ }
    }

    // sqrt carries its own domain: the curve does not exist left of the branch
    // point, so the renderer must never be asked to draw there
    try {
      const fit = fitSqrt(core, stroke.bbox.min.x)
      if (fit) {
        const sqrtDomain: [number, number] = [fit.params[1], stroke.bbox.max.x + padX]
        push(makeCandidate('sqrt', fit.params, 'explicit', sqrtDomain, fit.rms, diag, 3,
          fullRmsOf('sqrt', fit.params)))
      }
    } catch { /* skip */ }
  }

  // ---- closed -> circle, ellipse, Fourier -----------------------------------
  if (stroke.closed) {
    try {
      const c = fitCircle(pts)
      if (c) {
        const rms = rmsOf(pts.map(p => Math.hypot(p.x - c.cx, p.y - c.cy) - c.r))
        push(makeCandidate('circle', [c.cx, c.cy, c.r], 'implicit', null, rms, diag, 3))
      }
    } catch { /* skip */ }

    try {
      const conic = fitConic(pts)
      if (conic) {
        const [A, B, C] = conic
        if (B * B - 4 * A * C < 0) { // real ellipse only
          const rms = rmsOf(pts.map(p => conicGeometricDistance(conic, p.x, p.y)))
          push(makeCandidate('ellipse', conic, 'implicit', null, rms, diag, 5))
        }
      }
    } catch { /* skip */ }

    try {
      const f = fitFourier(pts, true, diag)
      if (f) {
        push(makeCandidate('fourier', f.params, 'parametric', [0, 2 * Math.PI], f.rms, diag, 2 + f.N))
      }
    } catch { /* skip */ }
  }

  // ---- winds around the origin -> polar families ----------------------------
  // Deliberately fitted on the FULL points, trimmed or not — the one place
  // the trim is not applied to an open stroke. Two reasons:
  //
  //  * Correctness. A spiral's parameters are tied to the UNWRAPPED θ origin,
  //    which is the stroke's first sample. Fit it on a trimmed θ range and
  //    report the full one and you print a spiral that misses its own ink.
  //  * The asymmetry is the safe direction. Keeping every point means these
  //    families keep every point of evidence AGAINST them, so an untrimmed
  //    polar residual can only cost a polar family a win it deserved — it can
  //    never manufacture one. Measured: circle, ellipse, both roses, limaçon,
  //    cardioid and spiral all stay at 120/120 for every trim fraction tested,
  //    so it costs nothing either.
  //
  // (Explicit and polar candidates do co-occur — a wide parabola through the
  // origin covers enough direction bins to reach here — so this is a real
  // comparison, not a dead branch. Their residuals are an order of magnitude
  // apart in those cases, which is why the asymmetry never decides anything.)
  try {
    const ps = polarSamples(pts, diag)
    const originInside =
      stroke.bbox.min.x < 0 && stroke.bbox.max.x > 0 &&
      stroke.bbox.min.y < 0 && stroke.bbox.max.y > 0
    const winds =
      ps !== null &&
      ps.monoFrac > 0.8 &&
      (Math.abs(ps.sweep) > 1.6 * Math.PI || ps.coverage >= 0.6)
    // petal-style strokes (roses, inner-loop limaçons) pass through the origin
    // repeatedly; their position angle covers only ~half the circle and jumps
    // by π at each origin crossing, so they need their own entry ticket.
    const petalStyle = ps !== null && ps.originDips >= 2 && originInside
    if (ps && (winds || petalStyle)) {
      const thetaLo = Math.min(ps.theta[0], ps.theta[ps.theta.length - 1])
      const thetaHi = Math.max(ps.theta[0], ps.theta[ps.theta.length - 1])
      const fullTurn: [number, number] = [0, 2 * Math.PI]
      const fitted: [number, number] = [thetaLo, thetaHi]

      const loopDomain = stroke.closed || petalStyle ? fullTurn : fitted
      const rose = fitRose(ps)
      if (rose) {
        push(makeCandidate('polarRose', rose.params, 'polar', loopDomain, rose.rms, diag, 3))
      }
      const lim = fitLimacon(ps)
      if (lim) {
        push(makeCandidate('limacon', lim.params, 'polar', loopDomain, lim.rms, diag, 2))
      }
      const sp = fitSpiral(ps)
      if (sp) {
        push(makeCandidate('spiral', sp.params, 'polar', fitted, sp.rms, diag, 2))
      }
    }
  } catch { /* skip */ }

  // ---- safety net -----------------------------------------------------------
  const best = out.reduce<number>((m, c) => Math.min(m, c.error / diag), Infinity)
  if (out.length === 0 || best > 0.08) {
    addFallback(stroke, out)
  }
}

/** Best-effort fallback: Fourier hug (mirrored if open), then poly3.
 *  Not trimmed: this is the escape hatch that runs when no family fits, and
 *  its whole job is to reproduce the ink the user actually drew. Trimming it
 *  would only lower its residual and shorten what it draws. */
function addFallback(stroke: ProcessedStroke, out: FitResult[]): void {
  const pts = stroke.points
  if (pts.length < 4) return
  const width = stroke.bbox.max.x - stroke.bbox.min.x
  const height = stroke.bbox.max.y - stroke.bbox.min.y
  const diag = Math.max(Math.hypot(width, height), 1e-9)

  const already = new Set(out.map(c => c.modelId))
  try {
    const f = fitFourier(pts, stroke.closed, diag)
    if (f && !already.has('fourier')) {
      const c = makeCandidate('fourier', f.params, 'parametric', [0, 2 * Math.PI], f.rms, diag, 2 + f.N)
      if (c) out.push(c)
    }
  } catch { /* skip */ }

  if (!stroke.closed && !already.has('poly3') && width > 1e-12) {
    try {
      const fit = fitPolyFamily(pts, 3)
      if (fit) {
        const padX = 0.05 * width
        const c = makeCandidate('poly3', fit.params, 'explicit',
          [stroke.bbox.min.x - padX, stroke.bbox.max.x + padX], fit.rms, diag, 4)
        if (c) out.push(c)
      }
    } catch { /* skip */ }
  }
}

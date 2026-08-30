// ============================================================================
// Stroke preprocessing: dedupe -> uniform arc-length resample -> light
// Gaussian smoothing. Also computes closedness, bbox, arc length, and a
// vertical-line-test flag. Pure functions, math coordinates throughout.
// ============================================================================

import type { Vec2, Viewport, ProcessedStroke } from './types'

const TARGET_POINTS = 200
const CLOSED_FRAC = 0.08     // endpoints within 8% of bbox diagonal
const CLOSED_MIN_RAW = 20    // and at least this many real input points
const BACKTRACK_FRAC = 0.15  // x-backtracking > 15% of x-extent => multi-valued

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function bboxOf(pts: Vec2[]): { min: Vec2; max: Vec2 } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  if (!Number.isFinite(minX)) { minX = minY = maxX = maxY = 0 }
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } }
}

function polylineLength(pts: Vec2[]): number {
  let L = 0
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i])
  return L
}

/** Uniform arc-length resampling to exactly n points (keeps both endpoints). */
function resample(pts: Vec2[], n: number): Vec2[] {
  const total = polylineLength(pts)
  if (total <= 0 || pts.length < 2) return pts.map(p => ({ x: p.x, y: p.y }))
  const step = total / (n - 1)
  const out: Vec2[] = [{ x: pts[0].x, y: pts[0].y }]
  let acc = 0
  let i = 1
  let prev = pts[0]
  while (out.length < n - 1 && i < pts.length) {
    const seg = dist(prev, pts[i])
    if (acc + seg >= step && seg > 0) {
      const t = (step - acc) / seg
      const q = { x: prev.x + t * (pts[i].x - prev.x), y: prev.y + t * (pts[i].y - prev.y) }
      out.push(q)
      prev = q
      acc = 0
    } else {
      acc += seg
      prev = pts[i]
      i++
    }
  }
  while (out.length < n - 1) out.push({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y })
  out.push({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y })
  return out
}

// --- open-end handling for the smoother ------------------------------------
//
// The kernel needs `radius` samples beyond each end of an open stroke. Two
// obvious choices are both wrong here:
//
//   * REPLICATE (clamp j to 0 / n-1) feeds the same raw endpoint into the
//     kernel several times, so its jitter is amplified into its neighbours;
//     pinning the endpoint to the raw ink on top of that leaves it with 100%
//     of its noise while the interior keeps ~40%. That is the bug: the ends
//     were the noisiest part of the "smoothed" stroke.
//   * MIRROR (p[-k] = p[k]) folds the stroke back on itself, forcing a zero
//     derivative at the boundary. It denoises, but it drags the endpoint
//     inward along the tangent by ~1 sample — i.e. it quietly SHORTENS the
//     stroke, which is exactly what the raw anchoring was there to prevent.
//
// So we do not pad at all. For the few points where the kernel would overhang,
// we use a different estimator with the same job: a Savitzky-Golay fit — a
// least-squares QUADRATIC through the nearest END_WINDOW samples — evaluated
// at the point's own index. It is one-sided, so it never reaches for data that
// isn't there, and it is evaluated where the point already is, so the point is
// denoised in place rather than displaced. Both coordinates get the same
// treatment (see processStroke: x carries as much of the visible endpoint
// error as y does).
//
// Degree 2 is deliberate and load-bearing. A degree-1 (straight-line) fit
// cannot represent a curved end, so it FLATTENS the last few points — the
// exact artifact that makes recognition prefer a sinusoid over a parabola.
// Measured with jitter off, so the number is pure estimator bias, a linear fit
// displaces the tip of a gaussian by 0.0156 math units against a 0.0014 local
// noise floor; the quadratic keeps every shape tested under 0.0059, well below
// the ~0.013 the hand jitter leaves behind anyway.
//
// A wide window is also deliberate: it dilutes a two- or three-sample pen-lift
// hook (which currently dictates the endpoint outright, at full weight) to
// roughly 3/21 of a least-squares fit. That attenuates a hook, it does not
// remove one, and nothing is trimmed — the stroke keeps all n points and the
// full extent the user drew.
const END_DEGREE = 2
const END_WINDOW = 21

/**
 * Least-squares polynomial of degree `deg` through (u[i], v[i]).
 * Returns coefficients [c0, c1, ...] of c0 + c1·u + c2·u² + ...
 * Falls back to lower degree if the normal equations are singular.
 */
function polyFitLS(us: number[], vs: number[], deg: number): number[] {
  const m = deg + 1
  // normal equations A·c = b with A[r][q] = Σ u^(r+q), b[r] = Σ v·u^r
  const A: number[][] = []
  const b: number[] = []
  for (let r = 0; r < m; r++) {
    A.push(new Array(m).fill(0))
    b.push(0)
  }
  for (let i = 0; i < us.length; i++) {
    const pow: number[] = [1]
    for (let e = 1; e < 2 * m; e++) pow.push(pow[e - 1] * us[i])
    for (let r = 0; r < m; r++) {
      for (let q = 0; q < m; q++) A[r][q] += pow[r + q]
      b[r] += vs[i] * pow[r]
    }
  }
  // Gaussian elimination with partial pivoting
  for (let c = 0; c < m; c++) {
    let piv = c
    for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r
    if (Math.abs(A[piv][c]) < 1e-12) {
      // singular (degenerate window): drop to the highest degree that works
      return deg > 0 ? polyFitLS(us, vs, deg - 1) : [vs.length ? vs[0] : 0]
    }
    if (piv !== c) { const t = A[piv]; A[piv] = A[c]; A[c] = t; const tb = b[piv]; b[piv] = b[c]; b[c] = tb }
    for (let r = c + 1; r < m; r++) {
      const f = A[r][c] / A[c][c]
      if (f === 0) continue
      for (let q = c; q < m; q++) A[r][q] -= f * A[c][q]
      b[r] -= f * b[c]
    }
  }
  const c = new Array(m).fill(0)
  for (let r = m - 1; r >= 0; r--) {
    let s = b[r]
    for (let q = r + 1; q < m; q++) s -= A[r][q] * c[q]
    c[r] = s / A[r][r]
  }
  return c
}

function polyEval(c: number[], u: number): number {
  let v = 0
  for (let e = c.length - 1; e >= 0; e--) v = v * u + c[e]
  return v
}

/**
 * Denoised value for a point in the boundary band, where the Gaussian kernel
 * has no data on one side. Fits a local least-squares polynomial to the
 * nearest END_WINDOW samples (measured from the end being repaired) and
 * evaluates it AT the point's own index — no extrapolation, no displacement.
 *
 * `head` = true for the band at index 0; false for the band at index n-1.
 * `off` is the distance from that end (0 = the endpoint itself).
 */
function endBandPoint(pts: Vec2[], off: number, head: boolean): Vec2 {
  const n = pts.length
  const w = Math.min(END_WINDOW, n)
  const us: number[] = []
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < w; i++) {
    const idx = head ? i : n - 1 - i
    us.push(i)               // local coordinate: distance from the end
    xs.push(pts[idx].x)
    ys.push(pts[idx].y)
  }
  const deg = Math.min(END_DEGREE, w - 1)
  const x = polyEval(polyFitLS(us, xs, deg), off)
  const y = polyEval(polyFitLS(us, ys, deg), off)
  const fallback = pts[head ? off : n - 1 - off]
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : { x: fallback.x, y: fallback.y }
}

/**
 * Light Gaussian smoothing. Closed strokes wrap. Open strokes use the Gaussian
 * wherever it fits entirely inside the stroke, and the one-sided quadratic fit
 * above for the `radius` points at each end, so the ends come out as clean as
 * the interior without being moved, shortened, or extended.
 */
function gaussianSmooth(pts: Vec2[], closed: boolean): Vec2[] {
  const n = pts.length
  if (n < 5) return pts
  const sigma = 1.3
  const radius = 3
  const kernel: number[] = []
  let ksum = 0
  for (let k = -radius; k <= radius; k++) {
    const w = Math.exp(-(k * k) / (2 * sigma * sigma))
    kernel.push(w)
    ksum += w
  }
  for (let k = 0; k < kernel.length; k++) kernel[k] /= ksum

  const out: Vec2[] = new Array(n)
  for (let i = 0; i < n; i++) {
    if (!closed && i < radius) { out[i] = endBandPoint(pts, i, true); continue }
    if (!closed && i > n - 1 - radius) { out[i] = endBandPoint(pts, n - 1 - i, false); continue }
    let sx = 0, sy = 0
    for (let k = -radius; k <= radius; k++) {
      const j = closed ? (((i + k) % n) + n) % n : i + k
      const w = kernel[k + radius]
      sx += pts[j].x * w
      sy += pts[j].y * w
    }
    out[i] = { x: sx, y: sy }
  }
  return out
}

export function processStroke(raw: Vec2[], vp: Viewport): ProcessedStroke {
  const finite = raw.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))

  // --- dedupe near-duplicate points (~half a pixel in math units) ---
  const minGap = 0.5 / Math.max(vp.pxPerUnit, 1e-9)
  const deduped: Vec2[] = []
  for (const p of finite) {
    if (deduped.length === 0 || dist(deduped[deduped.length - 1], p) > minGap) {
      deduped.push({ x: p.x, y: p.y })
    }
  }
  // always retain the true last point (it may have been swallowed by the gap test)
  if (finite.length > 1 && deduped.length > 0) {
    const last = finite[finite.length - 1]
    if (dist(deduped[deduped.length - 1], last) > 1e-12) deduped.push({ x: last.x, y: last.y })
  }

  if (deduped.length < 2) {
    const p = deduped[0] ?? { x: 0, y: 0 }
    return {
      points: deduped.map(q => ({ x: q.x, y: q.y })),
      closed: false,
      arcLength: 0,
      bbox: { min: { x: p.x, y: p.y }, max: { x: p.x, y: p.y } },
      multiValuedX: false,
    }
  }

  // --- closedness (from the raw ink, before smoothing shrinks anything) ---
  const rawBBox = bboxOf(deduped)
  const rawDiag = dist(rawBBox.min, rawBBox.max)
  const closed =
    rawDiag > 0 &&
    deduped.length > CLOSED_MIN_RAW &&
    dist(deduped[0], deduped[deduped.length - 1]) < CLOSED_FRAC * rawDiag

  // --- resample + smooth ---
  const n = Math.min(TARGET_POINTS, Math.max(deduped.length, 16))
  const resampled = resample(deduped, Math.max(n, 16))
  const smoothed = gaussianSmooth(resampled, closed)

  const bbox = bboxOf(smoothed)
  const arcLength = polylineLength(smoothed)

  // --- vertical line test: total x backtracking vs x extent ---
  let sumPos = 0, sumNeg = 0
  for (let i = 1; i < smoothed.length; i++) {
    const dx = smoothed[i].x - smoothed[i - 1].x
    if (dx > 0) sumPos += dx
    else sumNeg -= dx
  }
  const width = bbox.max.x - bbox.min.x
  const backtrack = Math.min(sumPos, sumNeg)
  const multiValuedX = width <= 1e-12 ? true : backtrack > BACKTRACK_FRAC * width

  return { points: smoothed, closed, arcLength, bbox, multiValuedX }
}

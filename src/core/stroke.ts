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

/** Light Gaussian smoothing; wraps for closed strokes, clamps at open ends. */
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
    let sx = 0, sy = 0
    for (let k = -radius; k <= radius; k++) {
      let j = i + k
      if (closed) {
        j = ((j % n) + n) % n
      } else {
        if (j < 0) j = 0
        if (j > n - 1) j = n - 1
      }
      const w = kernel[k + radius]
      sx += pts[j].x * w
      sy += pts[j].y * w
    }
    out[i] = { x: sx, y: sy }
  }
  // keep open endpoints anchored to the drawn ink
  if (!closed) {
    out[0] = { x: pts[0].x, y: pts[0].y }
    out[n - 1] = { x: pts[n - 1].x, y: pts[n - 1].y }
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

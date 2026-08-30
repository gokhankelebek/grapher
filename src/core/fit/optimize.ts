// ============================================================================
// Numerical optimization toolbox:
//   - dense linear solve (Gaussian elimination, partial pivoting)
//   - linear least squares via normal equations (+ tiny ridge)
//   - polynomial fitting with centering/scaling for conditioning
//   - Levenberg–Marquardt with numeric Jacobian (bounded, damped, safe)
//   - algebraic circle fit (Kåsa) and direct conic/ellipse fit
// Pure TS, no dependencies, never throws on bad data (returns null).
// ============================================================================

import type { Vec2 } from '../types'

// ---------------------------------------------------------------------------
// Linear algebra
// ---------------------------------------------------------------------------

/** Solve A x = b via Gauss–Jordan with partial pivoting. Returns null if singular. */
export function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = A.length
  if (n === 0 || b.length !== n) return null
  const M: number[][] = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r
    }
    if (!Number.isFinite(M[piv][col]) || Math.abs(M[piv][col]) < 1e-13) return null
    if (piv !== col) { const t = M[piv]; M[piv] = M[col]; M[col] = t }
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = M[r][col] / M[col][col]
      if (f === 0) continue
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c]
    }
  }
  const x = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    x[i] = M[i][n] / M[i][i]
    if (!Number.isFinite(x[i])) return null
  }
  return x
}

/**
 * Least squares: given rows of basis values (one row per observation) and
 * targets ys, returns coefficients minimizing ||rows·c − ys||². Normal
 * equations with a tiny relative ridge for numerical safety.
 */
export function linearLeastSquares(rows: number[][], ys: number[]): number[] | null {
  const n = rows.length
  if (n === 0 || ys.length !== n) return null
  const m = rows[0].length
  const AtA: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0))
  const Aty = new Array<number>(m).fill(0)
  for (let i = 0; i < n; i++) {
    const r = rows[i]
    for (let j = 0; j < m; j++) {
      if (!Number.isFinite(r[j])) return null
      Aty[j] += r[j] * ys[i]
      for (let k = j; k < m; k++) AtA[j][k] += r[j] * r[k]
    }
  }
  for (let j = 0; j < m; j++) for (let k = 0; k < j; k++) AtA[j][k] = AtA[k][j]
  let trace = 0
  for (let j = 0; j < m; j++) trace += AtA[j][j]
  const ridge = 1e-12 * (trace / m + 1)
  for (let j = 0; j < m; j++) AtA[j][j] += ridge
  return solveLinearSystem(AtA, Aty)
}

// ---------------------------------------------------------------------------
// Polynomial fitting (with centering/scaling to keep normal equations sane)
// ---------------------------------------------------------------------------

function polyMul(a: number[], b: number[]): number[] {
  const out = new Array<number>(a.length + b.length - 1).fill(0)
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j]
  }
  return out
}

/**
 * Fit y ≈ Σ c_i x^i (ascending coefficients, length degree+1).
 * Internally fits in u = (x − mx)/sx and expands back for conditioning.
 * Optional per-point weights (≥ 0).
 */
export function polyfit(
  xs: number[],
  ys: number[],
  degree: number,
  weights?: number[],
): number[] | null {
  const n = xs.length
  if (n < degree + 1) return null
  let mx = 0
  for (const x of xs) mx += x
  mx /= n
  let sx = 0
  for (const x of xs) sx = Math.max(sx, Math.abs(x - mx))
  if (sx <= 0) return null

  const rows: number[][] = []
  const targets: number[] = []
  for (let i = 0; i < n; i++) {
    const w = weights ? Math.sqrt(Math.max(weights[i], 0)) : 1
    const u = (xs[i] - mx) / sx
    const row = new Array<number>(degree + 1)
    let pw = 1
    for (let j = 0; j <= degree; j++) { row[j] = pw * w; pw *= u }
    rows.push(row)
    targets.push(ys[i] * w)
  }
  const cU = linearLeastSquares(rows, targets)
  if (!cU) return null

  // expand p(u) with u = (x − mx)/sx into ascending coefficients in x
  const coeffs = new Array<number>(degree + 1).fill(0)
  const base = [-mx / sx, 1 / sx] // u as a poly in x
  let acc: number[] = [1]
  for (let j = 0; j <= degree; j++) {
    for (let i = 0; i < acc.length; i++) coeffs[i] += cU[j] * acc[i]
    if (j < degree) acc = polyMul(acc, base)
  }
  return coeffs.every(Number.isFinite) ? coeffs : null
}

// ---------------------------------------------------------------------------
// Levenberg–Marquardt (numeric Jacobian)
// ---------------------------------------------------------------------------

export interface LMResult { params: number[]; rss: number; iterations: number }

function sanitize(r: number[]): number[] {
  for (let i = 0; i < r.length; i++) if (!Number.isFinite(r[i])) r[i] = 1e6
  return r
}

/**
 * Minimize Σ residuals(p)². Numeric forward-difference Jacobian, adaptive
 * damping, bounded iterations, graceful failure (returns null only if the
 * initial point is unusable — otherwise returns the best point seen).
 */
export function levenbergMarquardt(
  residuals: (p: number[]) => number[],
  p0: number[],
  maxIter = 100,
): LMResult | null {
  const m = p0.length
  let p = p0.slice()
  if (!p.every(Number.isFinite)) return null
  let r: number[]
  try { r = sanitize(residuals(p)) } catch { return null }
  const nObs = r.length
  if (nObs === 0) return null
  let rss = 0
  for (const v of r) rss += v * v
  if (!Number.isFinite(rss)) return null

  let lambda = 1e-3
  let iter = 0
  for (; iter < maxIter; iter++) {
    // numeric Jacobian, column by column
    const cols: number[][] = []
    let jacOk = true
    for (let j = 0; j < m; j++) {
      const h = 1e-6 * Math.max(1e-3, Math.abs(p[j]))
      const pj = p.slice()
      pj[j] += h
      let rj: number[]
      try { rj = sanitize(residuals(pj)) } catch { jacOk = false; break }
      if (rj.length !== nObs) { jacOk = false; break }
      const col = new Array<number>(nObs)
      for (let i = 0; i < nObs; i++) col[i] = (rj[i] - r[i]) / h
      cols.push(col)
    }
    if (!jacOk) break

    // normal equations: (JtJ + λ·diag(JtJ)) δ = −Jt r
    const A: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0))
    const g = new Array<number>(m).fill(0)
    for (let j = 0; j < m; j++) {
      for (let k = j; k < m; k++) {
        let s = 0
        for (let i = 0; i < nObs; i++) s += cols[j][i] * cols[k][i]
        A[j][k] = s
        A[k][j] = s
      }
      let gj = 0
      for (let i = 0; i < nObs; i++) gj += cols[j][i] * r[i]
      g[j] = -gj
    }

    let improved = false
    for (let attempt = 0; attempt < 8; attempt++) {
      const Ad = A.map((row, j) =>
        row.map((v, k) => (j === k ? v + lambda * Math.max(v, 1e-12) : v)),
      )
      const delta = solveLinearSystem(Ad, g)
      if (delta) {
        const pNew = p.map((v, j) => v + delta[j])
        let rNew: number[] | null = null
        try { rNew = sanitize(residuals(pNew)) } catch { rNew = null }
        if (rNew && rNew.length === nObs) {
          let rssNew = 0
          for (const v of rNew) rssNew += v * v
          if (Number.isFinite(rssNew) && rssNew < rss) {
            const rel = (rss - rssNew) / (rss + 1e-300)
            p = pNew
            r = rNew
            rss = rssNew
            lambda = Math.max(lambda / 3, 1e-12)
            improved = true
            if (rel < 1e-9) iter = maxIter // converged
            break
          }
        }
      }
      lambda *= 5
      if (lambda > 1e10) break
    }
    if (!improved) break
  }
  return { params: p, rss, iterations: iter }
}

// ---------------------------------------------------------------------------
// Algebraic circle fit (Kåsa)
// ---------------------------------------------------------------------------

export interface CircleFit { cx: number; cy: number; r: number }

export function fitCircle(pts: Vec2[], weights?: number[]): CircleFit | null {
  const n = pts.length
  if (n < 3) return null
  let mx = 0, my = 0
  for (const p of pts) { mx += p.x; my += p.y }
  mx /= n
  my /= n
  const rows: number[][] = []
  const ys: number[] = []
  for (let i = 0; i < n; i++) {
    const p = pts[i]
    const w = weights ? Math.sqrt(Math.max(weights[i], 0)) : 1
    const u = p.x - mx, v = p.y - my
    rows.push([u * w, v * w, w])
    ys.push(-(u * u + v * v) * w)
  }
  const sol = linearLeastSquares(rows, ys)
  if (!sol) return null
  const [D, E, F] = sol
  const cx = -D / 2, cy = -E / 2
  const r2 = cx * cx + cy * cy - F
  if (!(r2 > 0) || !Number.isFinite(r2)) return null
  return { cx: cx + mx, cy: cy + my, r: Math.sqrt(r2) }
}

// ---------------------------------------------------------------------------
// Direct conic fit (rotation-invariant A + C = 1 constraint) + helpers
// ---------------------------------------------------------------------------

/**
 * Fits A x² + B xy + C y² + D x + E y + F = 0 with the rotation-invariant
 * constraint A + C = 1 (valid for ellipses). Data is centered/scaled first.
 * Returns [A, B, C, D, E, F] normalized to unit vector length, or null.
 */
export function fitConic(pts: Vec2[], weights?: number[]): number[] | null {
  const n = pts.length
  if (n < 6) return null
  let mx = 0, my = 0
  for (const p of pts) { mx += p.x; my += p.y }
  mx /= n
  my /= n
  let s = 0
  for (const p of pts) s += Math.hypot(p.x - mx, p.y - my)
  s /= n
  if (!(s > 0)) return null

  // with C = 1 − A: A(u²−v²) + B uv + D u + E v + F = −v²
  const rows: number[][] = []
  const ys: number[] = []
  for (let i = 0; i < n; i++) {
    const p = pts[i]
    const w = weights ? Math.sqrt(Math.max(weights[i], 0)) : 1
    const u = (p.x - mx) / s, v = (p.y - my) / s
    rows.push([(u * u - v * v) * w, u * v * w, u * w, v * w, w])
    ys.push(-(v * v) * w)
  }
  const sol = linearLeastSquares(rows, ys)
  if (!sol) return null
  const [A, B, D, E, F] = sol
  const C = 1 - A

  // back-transform u = (x − mx)/s, v = (y − my)/s to original coordinates
  const s2 = s * s
  const A2 = A / s2
  const B2 = B / s2
  const C2 = C / s2
  const D2 = (-2 * A * mx - B * my) / s2 + D / s
  const E2 = (-2 * C * my - B * mx) / s2 + E / s
  const F2 = (A * mx * mx + B * mx * my + C * my * my) / s2 - (D * mx + E * my) / s + F

  const out = [A2, B2, C2, D2, E2, F2]
  if (!out.every(Number.isFinite)) return null
  let norm = 0
  for (const v of out) norm += v * v
  norm = Math.sqrt(norm)
  if (!(norm > 0)) return null
  return out.map(v => v / norm)
}

export interface EllipseCenterForm {
  cx: number
  cy: number
  rx: number      // semi-axis along `angle`
  ry: number      // semi-axis perpendicular to `angle`
  angle: number   // radians, rotation of the rx axis from +x
}

/** Extract center form from conic [A,B,C,D,E,F]; null if not a real ellipse. */
export function conicToCenterForm(c: number[]): EllipseCenterForm | null {
  if (c.length < 6) return null
  const [A, B, C, D, E, F] = c
  if (!c.slice(0, 6).every(Number.isFinite)) return null
  const det = 4 * A * C - B * B
  // Degeneracy is a RATIO, not a magnitude. fitConic normalises the whole
  // 6-vector to unit length, so a conic far from the origin carries its size in
  // F and leaves the quadratic part tiny: an ellipse centred 3e4 out has
  // A, C ~ 1e-9 and det ~ 1e-17, which an absolute 1e-16 floor rejects as
  // "degenerate" while the curve itself is perfectly ordinary. Comparing det
  // against the quadratic part's own scale is invariant to that normalisation
  // (det/(A²+B²+C²) is O(1) for any circle, and ~4(r_min/r_max)² for an
  // ellipse), so the test means the same thing at every distance and zoom.
  const quad2 = A * A + B * B + C * C
  if (!(quad2 > 0)) return null
  if (!(det > 1e-12 * quad2)) return null // parabola/hyperbola/degenerate
  const cx = (B * E - 2 * C * D) / det
  const cy = (B * D - 2 * A * E) / det
  // Q0 = Q(cx, cy). Evaluating the quadratic at a far-off centre subtracts
  // O(cx²) terms to land on a value of order the (tiny) normalised scale; the
  // closed form below is the same quantity with the largest cancelling product
  // done once instead of three times:
  //   Q0 = F + (D·cx + E·cy)/2 = F + (BDE − CD² − AE²)/det
  const Q0 = F + (B * D * E - C * D * D - A * E * E) / det
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(Q0)) return null
  // translated conic: A u² + B uv + C v² = −Q0

  if (Math.abs(B) < 1e-9 * (Math.abs(A) + Math.abs(C) + 1e-300)) {
    const rx2 = -Q0 / A
    const ry2 = -Q0 / C
    if (!(rx2 > 0) || !(ry2 > 0)) return null
    return { cx, cy, rx: Math.sqrt(rx2), ry: Math.sqrt(ry2), angle: 0 }
  }

  const half = (A - C) / 2
  const dd = Math.hypot(half, B / 2)
  const l1 = (A + C) / 2 + dd
  const l2 = (A + C) / 2 - dd
  const r1sq = -Q0 / l1
  const r2sq = -Q0 / l2
  if (!(r1sq > 0) || !(r2sq > 0)) return null
  const angle = 0.5 * Math.atan2(B, A - C)
  // eigenvalue l1 corresponds to direction `angle`... verify orientation:
  // the axis direction for eigenvalue λ of [[A,B/2],[B/2,C]] with
  // θ = 0.5·atan2(B, A−C) belongs to λ1 = (A+C)/2 + dd.
  return { cx, cy, rx: Math.sqrt(r1sq), ry: Math.sqrt(r2sq), angle }
}

/** Inverse of conicToCenterForm: build [A,B,C,D,E,F] (unit norm) from center form. */
export function centerFormToConic(cf: EllipseCenterForm): number[] | null {
  const { cx, cy, rx, ry, angle } = cf
  if (!(rx > 0) || !(ry > 0)) return null
  const co = Math.cos(angle), si = Math.sin(angle)
  const irx2 = 1 / (rx * rx), iry2 = 1 / (ry * ry)
  const A = co * co * irx2 + si * si * iry2
  const C = si * si * irx2 + co * co * iry2
  const B = 2 * co * si * (irx2 - iry2)
  const D = -2 * A * cx - B * cy
  const E = -B * cx - 2 * C * cy
  const F = A * cx * cx + B * cx * cy + C * cy * cy - 1
  const out = [A, B, C, D, E, F]
  if (!out.every(Number.isFinite)) return null
  let norm = 0
  for (const v of out) norm += v * v
  norm = Math.sqrt(norm)
  if (!(norm > 0)) return null
  return out.map(v => v / norm)
}

/** Approximate geometric distance of a point to conic Q=0: |Q| / |∇Q|. */
export function conicGeometricDistance(c: number[], x: number, y: number): number {
  const [A, B, C, D, E, F] = c
  const q = A * x * x + B * x * y + C * y * y + D * x + E * y + F
  const gx = 2 * A * x + B * y + D
  const gy = B * x + 2 * C * y + E
  const g = Math.hypot(gx, gy)
  return g > 1e-12 ? Math.abs(q) / g : Math.abs(q) * 1e12
}

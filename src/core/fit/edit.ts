// ============================================================================
// Curve editing — "grab the math itself".
//   getHandles       model-aware control points per family
//   applyHandleDrag  exact closed-form updates where possible
//   dragCurvePoint   universal semantic drag (damped Gauss–Newton, soft anchors)
//   oversketch       redraw part of a curve in ink, refit the same family
//   snapParams       magnetize params to nice values
//   nearestOnCurve   closest curve point to p (hit-testing / grab finding)
//   applyFeatureEdit state a FEATURE, not a parameter: "put this zero at x = 2"
// Pure TS, no DOM, hot paths kept allocation-light (dragCurvePoint runs per
// pointermove).
// ============================================================================

import type {
  FittedCurve, ModelSpec, Vec2, CurveHandle,
  SpecialPoint, SpecialPointKind, FeatureEdit, FeatureEditResult,
} from '../types'
import { analyzeCurve } from '../analyze'
import {
  linearLeastSquares,
  levenbergMarquardt,
  polyfit,
  fitCircle,
  fitConic,
  conicToCenterForm,
  centerFormToConic,
  solveLinearSystem,
} from './optimize'

const TWO_PI = 2 * Math.PI
const SQRT_LN2 = Math.sqrt(Math.LN2)

// ---------------------------------------------------------------------------
// Geometry adapter: every curve becomes t ↦ Vec2 over a parameter interval
// ---------------------------------------------------------------------------

interface Geometry {
  fn(params: number[], t: number): Vec2
  dom: [number, number]
  cyclic: boolean
}

function geometryOf(curve: FittedCurve, spec: ModelSpec): Geometry | null {
  if (spec.kind === 'explicit' && spec.evalExplicit) {
    const ev = spec.evalExplicit.bind(spec)
    const dom: [number, number] = curve.domain ? [curve.domain[0], curve.domain[1]] : [-10, 10]
    return { fn: (p, t) => ({ x: t, y: ev(p, t) }), dom, cyclic: false }
  }
  if (spec.kind === 'polar' && spec.evalPolar) {
    const ev = spec.evalPolar.bind(spec)
    const dom: [number, number] = curve.domain ? [curve.domain[0], curve.domain[1]] : [0, TWO_PI]
    const cyclic = dom[1] - dom[0] >= TWO_PI - 1e-6
    return {
      fn: (p, t) => {
        const r = ev(p, t)
        return { x: r * Math.cos(t), y: r * Math.sin(t) }
      },
      dom,
      cyclic,
    }
  }
  if (spec.kind === 'parametric' && spec.evalParametric) {
    const ev = spec.evalParametric.bind(spec)
    const cyclic = curve.modelId === 'fourier'
    const dom: [number, number] = curve.domain
      ? [curve.domain[0], curve.domain[1]]
      : cyclic ? [0, TWO_PI] : [-10, 10]
    return { fn: (p, t) => ev(p, t), dom, cyclic }
  }
  if (spec.kind === 'implicit') {
    if (curve.modelId === 'circle') {
      return {
        fn: (p, t) => ({ x: p[0] + p[2] * Math.cos(t), y: p[1] + p[2] * Math.sin(t) }),
        dom: [0, TWO_PI],
        cyclic: true,
      }
    }
    // general conic (ellipse): parametrize through center form each eval so
    // dragCurvePoint can vary the conic coefficients directly
    return {
      fn: (p, t) => {
        const cf = conicToCenterForm(p)
        if (!cf) return { x: Number.NaN, y: Number.NaN }
        const co = Math.cos(cf.angle), si = Math.sin(cf.angle)
        const u = cf.rx * Math.cos(t), v = cf.ry * Math.sin(t)
        return { x: cf.cx + u * co - v * si, y: cf.cy + u * si + v * co }
      },
      dom: [0, TWO_PI],
      cyclic: true,
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// nearestOnCurve
// ---------------------------------------------------------------------------

function d2(a: Vec2, bx: number, by: number): number {
  const dx = a.x - bx, dy = a.y - by
  return dx * dx + dy * dy
}

function nearestInGeometry(
  geom: Geometry,
  params: number[],
  p: Vec2,
): { t: number; pos: Vec2; dist: number } {
  const [t0, t1] = geom.dom
  const span = t1 - t0
  const N = 96
  let bestT = t0
  let bestD = Infinity
  const step = span / (geom.cyclic ? N : N - 1)
  for (let i = 0; i < N; i++) {
    const t = t0 + i * step
    const q = geom.fn(params, t)
    const dd = d2(q, p.x, p.y)
    if (dd < bestD) { bestD = dd; bestT = t }
  }
  // golden-section refine around the best coarse sample
  let lo = bestT - step
  let hi = bestT + step
  if (!geom.cyclic) {
    lo = Math.max(t0, lo)
    hi = Math.min(t1, hi)
  }
  const phi = 0.6180339887498949
  let a = hi - (hi - lo) * phi
  let b = lo + (hi - lo) * phi
  let fa = d2(geom.fn(params, a), p.x, p.y)
  let fb = d2(geom.fn(params, b), p.x, p.y)
  for (let i = 0; i < 28; i++) {
    if (fa < fb) {
      hi = b; b = a; fb = fa
      a = hi - (hi - lo) * phi
      fa = d2(geom.fn(params, a), p.x, p.y)
    } else {
      lo = a; a = b; fa = fb
      b = lo + (hi - lo) * phi
      fb = d2(geom.fn(params, b), p.x, p.y)
    }
  }
  let t = (lo + hi) / 2
  if (geom.cyclic) {
    // normalize into the domain
    t = t0 + ((((t - t0) % span) + span) % span)
  }
  const pos = geom.fn(params, t)
  const refined = d2(pos, p.x, p.y)
  if (refined <= bestD) return { t, pos, dist: Math.sqrt(refined) }
  const coarsePos = geom.fn(params, bestT)
  return { t: bestT, pos: coarsePos, dist: Math.sqrt(bestD) }
}

export function nearestOnCurve(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  p: Vec2,
): { t: number; pos: Vec2; dist: number } {
  const spec = models[curve.modelId]
  const geom = spec ? geometryOf(curve, spec) : null
  if (!geom) return { t: 0, pos: { x: p.x, y: p.y }, dist: Infinity }
  return nearestInGeometry(geom, curve.params, p)
}

// ---------------------------------------------------------------------------
// getHandles
// ---------------------------------------------------------------------------

/** Canonical center form: major axis first (rx ≥ ry), angle in (−π/2, π/2]. */
function canonicalCF(
  cf: ReturnType<typeof conicToCenterForm>,
): { cx: number; cy: number; rx: number; ry: number; angle: number } | null {
  if (!cf) return null
  let { rx, ry, angle } = cf
  if (rx < ry) {
    const t = rx; rx = ry; ry = t
    angle += Math.PI / 2
  }
  while (angle > Math.PI / 2) angle -= Math.PI
  while (angle <= -Math.PI / 2) angle += Math.PI
  return { cx: cf.cx, cy: cf.cy, rx, ry, angle }
}

function handle(
  id: string,
  pos: Vec2,
  kind: CurveHandle['kind'],
  label?: string,
  cursor?: string,
): CurveHandle {
  return { id, pos, kind, label, cursor }
}

/** ascending-coefficient poly derivative */
function polyDeriv(c: number[]): number[] {
  const out: number[] = []
  for (let i = 1; i < c.length; i++) out.push(c[i] * i)
  return out
}

function horner(c: number[], x: number): number {
  let v = 0
  for (let i = c.length - 1; i >= 0; i--) v = v * x + c[i]
  return v
}

/** real roots of a polynomial (ascending coeffs) inside [lo, hi], via sampling + bisection */
function polyRootsIn(c: number[], lo: number, hi: number): number[] {
  const roots: number[] = []
  const N = 120
  let prevX = lo
  let prevV = horner(c, lo)
  for (let i = 1; i <= N; i++) {
    const x = lo + ((hi - lo) * i) / N
    const v = horner(c, x)
    if (prevV === 0) roots.push(prevX)
    else if (prevV * v < 0) {
      let a = prevX, b = x, fa = prevV
      for (let k = 0; k < 40; k++) {
        const m = (a + b) / 2
        const fm = horner(c, m)
        if (fa * fm <= 0) b = m
        else { a = m; fa = fm }
      }
      roots.push((a + b) / 2)
    }
    prevX = x
    prevV = v
  }
  return roots
}

export function getHandles(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
): CurveHandle[] {
  const spec = models[curve.modelId]
  if (!spec) return []
  const p = curve.params
  const out: CurveHandle[] = []
  const explicitDomain = (): [number, number] =>
    curve.domain ? [curve.domain[0], curve.domain[1]] : [-10, 10]

  const addExplicitDomainHandles = (label0 = 'trim start', label1 = 'trim end') => {
    if (!spec.evalExplicit) return
    const [x0, x1] = explicitDomain()
    out.push(handle('domain-start', { x: x0, y: spec.evalExplicit(p, x0) }, 'domain-start', label0, 'ew-resize'))
    out.push(handle('domain-end', { x: x1, y: spec.evalExplicit(p, x1) }, 'domain-end', label1, 'ew-resize'))
  }

  switch (curve.modelId) {
    case 'line': {
      addExplicitDomainHandles('pivot / trim', 'pivot / trim')
      break
    }
    case 'vline': {
      const dom = curve.domain ?? [-10, 10]
      const midY = (dom[0] + dom[1]) / 2
      out.push(handle('position', { x: p[0], y: midY }, 'feature', 'position', 'ew-resize'))
      out.push(handle('domain-start', { x: p[0], y: dom[0] }, 'domain-start', 'trim', 'ns-resize'))
      out.push(handle('domain-end', { x: p[0], y: dom[1] }, 'domain-end', 'trim', 'ns-resize'))
      break
    }
    case 'poly2': {
      const [, c1, c2] = p
      if (Math.abs(c2) > 1e-12 && spec.evalExplicit) {
        const xv = -c1 / (2 * c2)
        const yv = spec.evalExplicit(p, xv)
        out.push(handle('vertex', { x: xv, y: yv }, 'feature', 'vertex', 'move'))
        out.push(handle('width', { x: xv + 1, y: yv + c2 }, 'feature', 'width', 'ns-resize'))
      }
      addExplicitDomainHandles()
      break
    }
    case 'poly3': {
      if (spec.evalExplicit && Math.abs(p[3]) > 1e-12) {
        const xi = -p[2] / (3 * p[3])
        const [x0, x1] = explicitDomain()
        const xc = xi >= x0 && xi <= x1 ? xi : (x0 + x1) / 2
        out.push(handle('inflection', { x: xc, y: spec.evalExplicit(p, xc) }, 'feature', 'move curve', 'move'))
      }
      addExplicitDomainHandles()
      break
    }
    case 'poly4': {
      if (spec.evalExplicit) {
        const [x0, x1] = explicitDomain()
        const roots = polyRootsIn(polyDeriv(p), x0, x1)
        const mid = (x0 + x1) / 2
        let xc = mid
        let best = Infinity
        for (const r of roots) {
          if (Math.abs(r - mid) < best) { best = Math.abs(r - mid); xc = r }
        }
        out.push(handle('extremum', { x: xc, y: spec.evalExplicit(p, xc) }, 'feature', 'move curve', 'move'))
      }
      addExplicitDomainHandles()
      break
    }
    case 'sine': {
      const [a, b, c, d] = p
      const [x0, x1] = explicitDomain()
      const xm = (x0 + x1) / 2
      if (Math.abs(b) > 1e-9) {
        const n = Math.round((b * xm + c - Math.PI / 2) / TWO_PI)
        const xc = (Math.PI / 2 - c + TWO_PI * n) / b
        out.push(handle('crest', { x: xc, y: d + a }, 'feature', 'amplitude / phase', 'move'))
        out.push(handle('wavelength', { x: xc + TWO_PI / b, y: d + a }, 'feature', 'wavelength', 'ew-resize'))
      }
      out.push(handle('midline', { x: xm, y: d }, 'feature', 'midline', 'ns-resize'))
      addExplicitDomainHandles()
      break
    }
    case 'gauss': {
      const [a, b, c, d] = p
      out.push(handle('peak', { x: b, y: a + d }, 'feature', 'peak', 'move'))
      out.push(handle('width', { x: b + Math.abs(c) * SQRT_LN2, y: d + a / 2 }, 'feature', 'width', 'ew-resize'))
      addExplicitDomainHandles()
      break
    }
    case 'logistic': {
      const [a, b, c, d] = p
      out.push(handle('midpoint', { x: c, y: d + a / 2 }, 'feature', 'midpoint', 'move'))
      if (Math.abs(b) > 1e-9) {
        out.push(handle('rate', { x: c + Math.log(3) / b, y: d + 0.75 * a }, 'feature', 'steepness', 'ew-resize'))
      }
      addExplicitDomainHandles()
      break
    }
    case 'exp': {
      if (spec.evalExplicit) {
        const [x0, x1] = explicitDomain()
        const xm = (x0 + x1) / 2
        out.push(handle('anchor', { x: xm, y: spec.evalExplicit(p, xm) }, 'feature', 'move curve', 'move'))
      }
      addExplicitDomainHandles()
      break
    }
    case 'abs': {
      out.push(handle('vertex', { x: p[1], y: p[2] }, 'feature', 'vertex', 'move'))
      addExplicitDomainHandles()
      break
    }
    case 'log': {
      // A logarithm's asymptote is its position: everything else about the
      // curve is amplitude. The handle sits ON the asymptote (x = b) at the
      // height the curve has mid-domain, so it can be grabbed even though no
      // point of the curve is there.
      const [x0, x1] = explicitDomain()
      const lo = Math.max(x0, p[1])
      const xm = lo + 0.5 * Math.max(x1 - lo, 0)
      const ym = spec.evalExplicit ? spec.evalExplicit(p, xm) : p[2]
      out.push(handle('asymptote', { x: p[1], y: Number.isFinite(ym) ? ym : p[2] }, 'feature', 'asymptote', 'move'))
      if (spec.evalExplicit) {
        const xs = lo + 0.6 * Math.max(x1 - lo, 0)
        const ys = spec.evalExplicit(p, xs)
        if (Number.isFinite(ys)) {
          out.push(handle('scale', { x: xs, y: ys }, 'feature', 'steepness', 'ns-resize'))
        }
        // the curve does not exist left of b, so only the far end trims
        out.push(handle('domain-end', { x: x1, y: spec.evalExplicit(p, x1) }, 'domain-end', 'trim end', 'ew-resize'))
      }
      break
    }
    case 'recip': {
      // The two asymptotes cross at (b, c) — the centre of the hyperbola. It
      // is not a point of the curve either, but it is the point that MOVES the
      // curve, and it is what a student is asked to name.
      out.push(handle('asymptote', { x: p[1], y: p[2] }, 'feature', 'asymptotes', 'move'))
      if (spec.evalExplicit) {
        const [x0, x1] = explicitDomain()
        // a scale handle on whichever branch has more room to be dragged
        const right = x1 - p[1] >= p[1] - x0
        const xs = right ? p[1] + 0.4 * Math.max(x1 - p[1], 1e-6) : p[1] - 0.4 * Math.max(p[1] - x0, 1e-6)
        const ys = spec.evalExplicit(p, xs)
        if (Number.isFinite(ys)) {
          out.push(handle('scale', { x: xs, y: ys }, 'feature', 'steepness', 'ns-resize'))
        }
      }
      addExplicitDomainHandles()
      break
    }
    case 'sqrt':
    case 'cbrt':
    case 'power': {
      // The branch point (b, c) is the whole story for a root curve: it is
      // where the tangent goes vertical and, for sqrt, where the curve begins.
      out.push(handle('branch', { x: p[1], y: p[2] }, 'feature', 'branch point', 'move'))
      if (spec.evalExplicit) {
        const [x0, x1] = explicitDomain()
        // a scale handle partway along the drawn arm sets the steepness
        const xs = curve.modelId === 'sqrt' ? Math.max(x0, p[1]) : x0
        const xScale = xs + 0.6 * (x1 - xs)
        const yScale = spec.evalExplicit(p, xScale)
        if (Number.isFinite(yScale)) {
          out.push(handle('scale', { x: xScale, y: yScale }, 'feature', 'steepness', 'ns-resize'))
        }
      }
      if (curve.modelId === 'sqrt') {
        // the curve does not exist left of b, so only the far end trims
        if (spec.evalExplicit) {
          const [, x1] = explicitDomain()
          out.push(handle('domain-end', { x: x1, y: spec.evalExplicit(p, x1) }, 'domain-end', 'trim end', 'ew-resize'))
        }
      } else {
        addExplicitDomainHandles()
      }
      break
    }
    case 'circle': {
      const [a, b, r] = p
      out.push(handle('center', { x: a, y: b }, 'center', 'center', 'move'))
      const s = r / Math.SQRT2
      out.push(handle('radius', { x: a + s, y: b + s }, 'radius', 'radius', 'nwse-resize'))
      break
    }
    case 'ellipse': {
      const cf = canonicalCF(conicToCenterForm(p))
      if (!cf) break
      const co = Math.cos(cf.angle), si = Math.sin(cf.angle)
      out.push(handle('center', { x: cf.cx, y: cf.cy }, 'center', 'center', 'move'))
      out.push(handle('axis-a', { x: cf.cx + cf.rx * co, y: cf.cy + cf.rx * si }, 'radius', 'semi-axis a', 'move'))
      out.push(handle('axis-b', { x: cf.cx - cf.ry * si, y: cf.cy + cf.ry * co }, 'radius', 'semi-axis b', 'move'))
      const rr = 1.25 * cf.rx // canonical: rx is the major axis
      out.push(handle('rotation', { x: cf.cx + rr * co, y: cf.cy + rr * si }, 'rotation', 'rotate', 'grab'))
      break
    }
    case 'polarRose': {
      const [a, k, c] = [p[0], Math.round(p[1]), p[2] ?? 0]
      const t0 = -c / Math.max(k, 1)
      out.push(handle('petal-tip', { x: a * Math.cos(t0), y: a * Math.sin(t0) }, 'feature', 'size / rotation', 'move'))
      break
    }
    case 'limacon': {
      const [a, b] = p
      const th = b >= 0 ? 0 : Math.PI
      const r = a + b * Math.cos(th)
      out.push(handle('outer', { x: r * Math.cos(th), y: r * Math.sin(th) }, 'feature', 'scale', 'move'))
      break
    }
    case 'spiral': {
      const dom = curve.domain ?? [0, 4 * Math.PI]
      const te = dom[1]
      const r = p[0] + p[1] * te
      out.push(handle('outer', { x: r * Math.cos(te), y: r * Math.sin(te) }, 'feature', 'scale', 'move'))
      break
    }
    case 'fourier': {
      if (!spec.evalParametric) break
      out.push(handle('center', { x: p[0], y: p[1] }, 'center', 'center', 'move'))
      for (let j = 0; j < 8; j++) {
        const t = (j * Math.PI) / 4
        out.push(handle(`pt-${j}`, spec.evalParametric(p, t), 'feature', 'deform', 'move'))
      }
      break
    }
    default: {
      // unknown family: fall back to domain handles when explicit
      addExplicitDomainHandles()
    }
  }
  return out.filter(h => Number.isFinite(h.pos.x) && Number.isFinite(h.pos.y))
}

// ---------------------------------------------------------------------------
// applyHandleDrag
// ---------------------------------------------------------------------------

const MIN_SPAN_FRAC = 1e-3

export function applyHandleDrag(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  handleId: string,
  target: Vec2,
): { params: number[]; domain: [number, number] | null } {
  const spec = models[curve.modelId]
  const params = curve.params.slice()
  let domain: [number, number] | null = curve.domain ? [curve.domain[0], curve.domain[1]] : null
  const unchanged = () => ({ params, domain })
  if (!spec || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return unchanged()

  const dom: [number, number] = domain ?? (spec.kind === 'explicit' ? [-10, 10] : [0, TWO_PI])
  const span = dom[1] - dom[0]
  const minSpan = Math.max(Math.abs(span) * MIN_SPAN_FRAC, 1e-9)

  // generic horizontal domain trim for explicit families
  const trimExplicit = (): { params: number[]; domain: [number, number] | null } => {
    if (handleId === 'domain-start') {
      domain = [Math.min(target.x, dom[1] - minSpan), dom[1]]
    } else {
      domain = [dom[0], Math.max(target.x, dom[0] + minSpan)]
    }
    return { params, domain }
  }

  switch (curve.modelId) {
    case 'line': {
      if (handleId !== 'domain-start' && handleId !== 'domain-end') break
      const ev = spec.evalExplicit
      if (!ev) break
      const fixedX = handleId === 'domain-start' ? dom[1] : dom[0]
      const fixedY = ev.call(spec, params, fixedX)
      let tx = target.x
      // keep the dragged end on its own side of the pivot
      if (handleId === 'domain-start') tx = Math.min(tx, fixedX - minSpan)
      else tx = Math.max(tx, fixedX + minSpan)
      const m = (target.y - fixedY) / (tx - fixedX)
      if (Number.isFinite(m)) {
        params[1] = m
        params[0] = fixedY - m * fixedX
      }
      domain = handleId === 'domain-start' ? [tx, dom[1]] : [dom[0], tx]
      return { params, domain }
    }
    case 'vline': {
      if (handleId === 'position') {
        params[0] = target.x
        return { params, domain }
      }
      if (handleId === 'domain-start') {
        domain = [Math.min(target.y, dom[1] - minSpan), dom[1]]
        return { params, domain }
      }
      if (handleId === 'domain-end') {
        domain = [dom[0], Math.max(target.y, dom[0] + minSpan)]
        return { params, domain }
      }
      break
    }
    case 'poly2': {
      const c1 = params[1], c2 = params[2]
      if (Math.abs(c2) > 1e-12 && spec.evalExplicit) {
        const xv = -c1 / (2 * c2)
        const yv = spec.evalExplicit(params, xv)
        if (handleId === 'vertex' && spec.translate) {
          const np = spec.translate(params, target.x - xv, target.y - yv)
          const nd: [number, number] | null = domain
            ? [domain[0] + (target.x - xv), domain[1] + (target.x - xv)]
            : null
          return { params: np, domain: nd }
        }
        if (handleId === 'width') {
          const v = target.y - yv
          if (Math.abs(v) > 1e-9) {
            params[2] = v
            params[1] = -2 * v * xv
            params[0] = yv + v * xv * xv
          }
          return { params, domain }
        }
      }
      if (handleId === 'domain-start' || handleId === 'domain-end') return trimExplicit()
      break
    }
    case 'poly3':
    case 'poly4':
    case 'exp': {
      if (handleId === 'domain-start' || handleId === 'domain-end') return trimExplicit()
      // feature handles translate the whole curve rigidly
      const hs = getHandles(curve, models)
      const h = hs.find(x => x.id === handleId)
      if (h && spec.translate) {
        const dx = target.x - h.pos.x
        const dy = target.y - h.pos.y
        const nd: [number, number] | null = domain ? [domain[0] + dx, domain[1] + dx] : null
        return { params: spec.translate(params, dx, dy), domain: nd }
      }
      break
    }
    case 'sine': {
      const [a, b, c, d] = params
      if (handleId === 'domain-start' || handleId === 'domain-end') return trimExplicit()
      if (Math.abs(b) > 1e-9) {
        const xm = (dom[0] + dom[1]) / 2
        const n = Math.round((b * xm + c - Math.PI / 2) / TWO_PI)
        const xc = (Math.PI / 2 - c + TWO_PI * n) / b
        if (handleId === 'crest') {
          const na = target.y - d
          if (Math.abs(na) > 1e-9) params[0] = na
          params[2] = c - b * (target.x - xc)
          return { params, domain }
        }
        if (handleId === 'wavelength') {
          const period = target.x - xc
          if (period > minSpan) {
            const nb = TWO_PI / period
            params[1] = nb
            params[2] = b * xc + c - nb * xc // keep the reference crest in place
          }
          return { params, domain }
        }
      }
      if (handleId === 'midline') {
        params[3] = target.y
        void a
        return { params, domain }
      }
      break
    }
    case 'gauss': {
      const [a, b, , d] = params
      if (handleId === 'domain-start' || handleId === 'domain-end') return trimExplicit()
      if (handleId === 'peak') {
        params[1] = target.x
        const na = target.y - d
        if (Math.abs(na) > 1e-9) params[0] = na
        return { params, domain }
      }
      if (handleId === 'width') {
        const nc = Math.abs(target.x - b) / SQRT_LN2
        if (nc > 1e-9) params[2] = nc
        void a
        return { params, domain }
      }
      break
    }
    case 'logistic': {
      const [a, b, c] = params
      if (handleId === 'domain-start' || handleId === 'domain-end') return trimExplicit()
      if (handleId === 'midpoint') {
        params[2] = target.x
        params[3] = target.y - a / 2
        return { params, domain }
      }
      if (handleId === 'rate') {
        const off = target.x - c
        if (Math.abs(off) > 1e-6) params[1] = Math.log(3) / off
        void b
        return { params, domain }
      }
      break
    }
    case 'abs': {
      if (handleId === 'domain-start' || handleId === 'domain-end') return trimExplicit()
      if (handleId === 'vertex') {
        params[1] = target.x
        params[2] = target.y
        return { params, domain }
      }
      break
    }
    case 'log':
    case 'recip': {
      if (handleId === 'domain-start' || handleId === 'domain-end') {
        const trimmed = trimExplicit()
        // a logarithm starts AT its asymptote — never let a trim expose the
        // empty half-plane left of it
        if (curve.modelId === 'log' && trimmed.domain) {
          trimmed.domain = [
            Math.max(trimmed.domain[0], params[1]),
            Math.max(trimmed.domain[1], params[1] + minSpan),
          ]
        }
        return trimmed
      }
      if (handleId === 'asymptote') {
        // moving the asymptote moves the curve with it: an exact translation
        const hs = getHandles(curve, models)
        const h = hs.find(x => x.id === 'asymptote')
        const dx = target.x - (h ? h.pos.x : params[1])
        const dy = target.y - (h ? h.pos.y : params[2])
        const np = spec.translate ? spec.translate(params, dx, dy) : params
        const nd: [number, number] | null = domain ? [domain[0] + dx, domain[1] + dx] : null
        return { params: np, domain: nd }
      }
      if (handleId === 'scale') {
        // closed form: with b and c pinned, a is linear in the dragged y
        const b = params[1]
        const c = params[2]
        const u = target.x - b
        const basis = curve.modelId === 'log' ? (u > 0 ? Math.log(u) : 0) : u === 0 ? 0 : 1 / u
        if (Math.abs(basis) > 1e-9) {
          const a = (target.y - c) / basis
          if (Number.isFinite(a) && Math.abs(a) > 1e-12) params[0] = a
        }
        return { params, domain }
      }
      break
    }
    case 'sqrt':
    case 'cbrt':
    case 'power': {
      if (handleId === 'domain-start' || handleId === 'domain-end') {
        const trimmed = trimExplicit()
        // sqrt starts AT its branch point — never let a trim expose empty space
        if (curve.modelId === 'sqrt' && trimmed.domain) {
          trimmed.domain = [
            Math.max(trimmed.domain[0], params[1]),
            Math.max(trimmed.domain[1], params[1] + minSpan),
          ]
        }
        return trimmed
      }
      if (handleId === 'branch') {
        // move the branch point: an exact rigid translation of the whole curve
        const dx = target.x - params[1]
        const dy = target.y - params[2]
        const np = spec.translate ? spec.translate(params, dx, dy) : params
        const nd: [number, number] | null = domain ? [domain[0] + dx, domain[1] + dx] : null
        return { params: np, domain: nd }
      }
      if (handleId === 'scale') {
        // closed form: with b and c pinned, a is linear in the dragged y
        const b = params[1]
        const c = params[2]
        const u = target.x - b
        let basis: number
        if (curve.modelId === 'sqrt') basis = u > 0 ? Math.sqrt(u) : 0
        else if (curve.modelId === 'cbrt') basis = Math.cbrt(u)
        else basis = Math.pow(Math.abs(u), params[3])
        if (Math.abs(basis) > 1e-9) {
          const a = (target.y - c) / basis
          if (Number.isFinite(a) && Math.abs(a) > 1e-12) params[0] = a
        }
        return { params, domain }
      }
      break
    }
    case 'circle': {
      if (handleId === 'center') {
        params[0] = target.x
        params[1] = target.y
        return { params, domain }
      }
      if (handleId === 'radius') {
        const r = Math.hypot(target.x - params[0], target.y - params[1])
        if (r > 1e-9) params[2] = r
        return { params, domain }
      }
      break
    }
    case 'ellipse': {
      const cf = canonicalCF(conicToCenterForm(params))
      if (!cf) break
      if (handleId === 'center') {
        const rebuilt = centerFormToConic({ ...cf, cx: target.x, cy: target.y })
        return { params: rebuilt ?? params, domain }
      }
      const vx = target.x - cf.cx
      const vy = target.y - cf.cy
      const len = Math.hypot(vx, vy)
      if (len < 1e-9) break
      const phi = Math.atan2(vy, vx)
      if (handleId === 'axis-a') {
        const rebuilt = centerFormToConic({ ...cf, rx: len, angle: phi })
        return { params: rebuilt ?? params, domain }
      }
      if (handleId === 'axis-b') {
        const rebuilt = centerFormToConic({ ...cf, ry: len, angle: phi - Math.PI / 2 })
        return { params: rebuilt ?? params, domain }
      }
      if (handleId === 'rotation') {
        // canonical form: rx is the major axis, whose end carries the handle
        const rebuilt = centerFormToConic({ ...cf, angle: phi })
        return { params: rebuilt ?? params, domain }
      }
      break
    }
    case 'polarRose': {
      if (handleId === 'petal-tip') {
        const len = Math.hypot(target.x, target.y)
        if (len > 1e-9) {
          const k = Math.max(1, Math.round(params[1]))
          params[0] = len
          params[2] = -k * Math.atan2(target.y, target.x)
        }
        return { params, domain }
      }
      break
    }
    case 'limacon':
    case 'spiral': {
      if (handleId === 'outer') {
        const hs = getHandles(curve, models)
        const h = hs.find(x => x.id === 'outer')
        if (h) {
          const cur = Math.hypot(h.pos.x, h.pos.y)
          const len = Math.hypot(target.x, target.y)
          if (cur > 1e-9 && len > 1e-9) {
            const s = len / cur
            params[0] *= s
            params[1] *= s
          }
        }
        return { params, domain }
      }
      break
    }
    case 'fourier': {
      if (handleId === 'center' && spec.translate) {
        return { params: spec.translate(params, target.x - params[0], target.y - params[1]), domain }
      }
      const m = /^pt-(\d+)$/.exec(handleId)
      if (m && spec.evalParametric) {
        const t = (Number(m[1]) * Math.PI) / 4
        const grab = spec.evalParametric(params, t)
        return { params: dragCurvePoint(curve, models, grab, target), domain }
      }
      break
    }
    default: {
      if (spec.kind === 'explicit' && (handleId === 'domain-start' || handleId === 'domain-end')) {
        return trimExplicit()
      }
    }
  }
  return unchanged()
}

// ---------------------------------------------------------------------------
// dragCurvePoint — universal semantic drag
// ---------------------------------------------------------------------------

const GRAB_WEIGHT = 16
const ANCHOR_COUNT = 24
const RIDGE = 0.01
const DRAG_ITERS = 12
/** Most any point may move, as a multiple of the drag distance. */
const DISPLACEMENT_CAP = 1.05

export function dragCurvePoint(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  grab: Vec2,
  target: Vec2,
): number[] {
  const spec = models[curve.modelId]
  const p0 = curve.params.slice()
  if (!spec) return p0
  const geom = geometryOf(curve, spec)
  if (!geom) return p0

  const tStar = nearestInGeometry(geom, p0, grab).t
  const [t0, t1] = geom.dom
  const span = t1 - t0
  if (!(span > 0)) return p0
  const sigma = 0.15 * span

  // anchors with weights growing away from the grab point
  const ts = new Array<number>(ANCHOR_COUNT)
  const w = new Array<number>(ANCHOR_COUNT)
  const anchor = new Array<Vec2>(ANCHOR_COUNT)
  const step = span / (geom.cyclic ? ANCHOR_COUNT : ANCHOR_COUNT - 1)
  for (let i = 0; i < ANCHOR_COUNT; i++) {
    const t = t0 + i * step
    ts[i] = t
    let d = Math.abs(t - tStar)
    if (geom.cyclic) d = Math.min(d, span - d)
    w[i] = 1 - Math.exp(-(d * d) / (2 * sigma * sigma))
    anchor[i] = geom.fn(p0, t)
  }

  const m = p0.length
  const scale = p0.map(v => Math.max(1, Math.abs(v)))
  // explicit curves are parametrized by x: the grabbed point slides with the
  // cursor's x, so the curve must pass through the target itself
  const grabT = spec.kind === 'explicit' ? target.x : tStar
  const residuals = (p: number[]): number[] => {
    const out = new Array<number>(2 + 2 * ANCHOR_COUNT + m)
    const g = geom.fn(p, grabT)
    out[0] = GRAB_WEIGHT * (g.x - target.x)
    out[1] = GRAB_WEIGHT * (g.y - target.y)
    let o = 2
    for (let i = 0; i < ANCHOR_COUNT; i++) {
      const q = geom.fn(p, ts[i])
      out[o++] = w[i] * (q.x - anchor[i].x)
      out[o++] = w[i] * (q.y - anchor[i].y)
    }
    for (let j = 0; j < m; j++) out[o++] = RIDGE * ((p[j] - p0[j]) / scale[j])
    return out
  }

  const res = levenbergMarquardt(residuals, p0, DRAG_ITERS)
  if (!res || !res.params.every(Number.isFinite)) return p0
  let out = res.params

  // A drag must never move part of the curve further than the grabbed point.
  //
  // Families with few global parameters have no local degree of freedom: a
  // sinusoid spanning several periods can only reach the cursor by sliding
  // phase and frequency, which whips the far side of the wave — measured at up
  // to 137% of the drag, so the curve ran away from the hand that moved it.
  // Regularizing the solve cannot fix this without also stiffening families
  // that localize perfectly well, so the invariant is imposed on the result
  // instead: shorten the parameter step until the worst displacement anywhere
  // on the curve is within CAP of the drag. Well-behaved drags never reach the
  // cap and are returned untouched.
  const drag = Math.hypot(target.x - grab.x, target.y - grab.y)
  if (drag > 0) {
    const limit = DISPLACEMENT_CAP * drag
    if (worstDisplacement(geom, p0, out, limit) > limit) {
      let lo = 0
      let hi = 1
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2
        const trial = p0.map((v, j) => v + mid * (out[j] - v))
        if (worstDisplacement(geom, p0, trial, limit) <= limit) lo = mid
        else hi = mid
      }
      out = p0.map((v, j) => v + lo * (out[j] - v))
    }
  }

  // integer params (rose petal count) must never drift
  if (curve.modelId === 'polarRose') out[1] = Math.round(p0[1])
  return out
}

/** Golden-section MAXIMUM of g on [a, b] — derivative free, so a cusp or a
 *  branch point does not derail it. */
function goldenMax(g: (t: number) => number, a: number, b: number): number {
  const phi = 0.6180339887498949
  let lo = a
  let hi = b
  let x1 = hi - (hi - lo) * phi
  let x2 = lo + (hi - lo) * phi
  let f1 = g(x1)
  let f2 = g(x2)
  for (let i = 0; i < 60; i++) {
    if (!Number.isFinite(f1) || !Number.isFinite(f2)) break
    if (f1 > f2) {
      hi = x2; x2 = x1; f2 = f1
      x1 = hi - (hi - lo) * phi
      f1 = g(x1)
    } else {
      lo = x1; x1 = x2; f1 = f2
      x2 = lo + (hi - lo) * phi
      f2 = g(x2)
    }
    if (hi - lo < 1e-12 * Math.max(1, Math.abs(lo))) break
  }
  return 0.5 * (lo + hi)
}

/** How many places the displacement is sampled at before local refinement. */
const DISPLACEMENT_SAMPLES = 192
/** How many sampled peaks get golden-section refined. */
const DISPLACEMENT_PEAKS = 6

/**
 * Largest distance any point of the curve moves between two parameter sets.
 * Returns early once `bail` is exceeded — callers only ever ask whether the
 * displacement is within a limit.
 *
 * A fixed grid alone does not answer that question. Any feature narrower than
 * the sample spacing hides between samples: a gaussian of width 1 on [-10, 10]
 * sampled 48 times has its peak 0.21 away from the nearest sample, so a drag
 * that grew the peak from 2 to 3.58 — 1.66x the drag distance, well past the
 * cap — measured 0.96x and was let through unshortened. So the grid is used to
 * BRACKET the maxima, and each candidate peak is then maximised properly; the
 * cap is enforced against the curve's real worst displacement, not the grid's.
 */
function worstDisplacement(
  geom: Geometry,
  from: number[],
  to: number[],
  bail: number,
): number {
  const [t0, t1] = geom.dom
  const span = t1 - t0
  const N = DISPLACEMENT_SAMPLES
  const step = span / (geom.cyclic ? N : N - 1)
  const disp = (t: number): number => {
    const a = geom.fn(from, t)
    const b = geom.fn(to, t)
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) return 0
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) return 0
    return Math.hypot(b.x - a.x, b.y - a.y)
  }

  const ds = new Array<number>(N)
  let worst = 0
  for (let i = 0; i < N; i++) {
    const d = disp(t0 + i * step)
    ds[i] = d
    if (d > worst) {
      worst = d
      if (worst > bail) return worst
    }
  }

  // refine the tallest sampled peaks; a hidden feature shows up as the peak of
  // its own shoulder even when the sample on top of it reads low
  const peaks: number[] = []
  for (let i = 0; i < N; i++) {
    const prev = i > 0 ? ds[i - 1] : geom.cyclic ? ds[N - 1] : ds[i]
    const next = i + 1 < N ? ds[i + 1] : geom.cyclic ? ds[0] : ds[i]
    if (ds[i] >= prev && ds[i] >= next) peaks.push(i)
  }
  peaks.sort((a, b) => ds[b] - ds[a])
  const limit = Math.min(peaks.length, DISPLACEMENT_PEAKS)
  for (let k = 0; k < limit; k++) {
    const i = peaks[k]
    let a = t0 + (i - 1) * step
    let b = t0 + (i + 1) * step
    if (!geom.cyclic) {
      a = Math.max(t0, a)
      b = Math.min(t1, b)
    }
    if (!(b > a)) continue
    const d = disp(goldenMax(disp, a, b))
    if (d > worst) {
      worst = d
      if (worst > bail) return worst
    }
  }
  return worst
}

// ---------------------------------------------------------------------------
// oversketch — redraw a stretch of the curve in ink, refit the same family
// ---------------------------------------------------------------------------

interface Blended { pt: Vec2; t: number; w: number }

function resampleInk(ink: Vec2[], n: number): Vec2[] {
  const pts = ink.filter(q => Number.isFinite(q.x) && Number.isFinite(q.y))
  if (pts.length <= 2) return pts
  let total = 0
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  if (!(total > 0)) return [pts[0]]
  const step = total / (n - 1)
  const out: Vec2[] = [{ x: pts[0].x, y: pts[0].y }]
  let acc = 0
  let prev = pts[0]
  let i = 1
  while (out.length < n - 1 && i < pts.length) {
    const seg = Math.hypot(pts[i].x - prev.x, pts[i].y - prev.y)
    if (acc + seg >= step && seg > 0) {
      const f = (step - acc) / seg
      const q = { x: prev.x + f * (pts[i].x - prev.x), y: prev.y + f * (pts[i].y - prev.y) }
      out.push(q)
      prev = q
      acc = 0
    } else {
      acc += seg
      prev = pts[i]
      i++
    }
  }
  out.push({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y })
  return out
}

export function oversketch(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  ink: Vec2[],
): { params: number[]; error: number } | null {
  const spec = models[curve.modelId]
  if (!spec) return null
  const geom = geometryOf(curve, spec)
  if (!geom) return null
  const inkPts = resampleInk(ink, 80)
  if (inkPts.length < 4) return null
  const p0 = curve.params
  const [t0, t1] = geom.dom
  const span = t1 - t0
  if (!(span > 0)) return null

  // parameter values the ink covers
  const explicit = spec.kind === 'explicit'
  const inkTs = inkPts.map(q =>
    explicit ? Math.min(Math.max(q.x, t0), t1) : nearestInGeometry(geom, p0, q).t,
  )

  // covered span: [lo, hi] for open curves; complement of the largest angular
  // gap for cyclic ones
  let lo: number
  let hi: number // hi may exceed t1 for cyclic wrap
  if (geom.cyclic) {
    const sorted = inkTs.slice().sort((a, b) => a - b)
    let gapStart = sorted[sorted.length - 1]
    let gapLen = sorted[0] + span - gapStart
    for (let i = 1; i < sorted.length; i++) {
      const g = sorted[i] - sorted[i - 1]
      if (g > gapLen) { gapLen = g; gapStart = sorted[i - 1] }
    }
    lo = gapStart + gapLen - span // covered start (≤ gapStart)
    hi = gapStart                 // covered end
    if (hi < lo) hi += span
  } else {
    lo = Math.min(...inkTs)
    hi = Math.max(...inkTs)
  }

  // blended point set: ink (heavily weighted — it is the new truth where it
  // covers) + kept samples of the current curve outside the covered span,
  // tapering to 0 at the seams (they preserve the uncovered region, they do
  // not veto the change)
  const INK_WEIGHT = 2.5
  const blended: Blended[] = inkPts.map((pt, i) => ({ pt, t: inkTs[i], w: INK_WEIGHT }))
  const inkCount = blended.length
  const K = 48
  const seam = 0.1 * span
  if (geom.cyclic) {
    const uncovered = span - (hi - lo)
    if (uncovered > 1e-9) {
      for (let i = 0; i < K; i++) {
        const u = ((i + 0.5) / K) * uncovered
        const t = hi + u // walk through the gap
        const dSeam = Math.min(u, uncovered - u)
        const wgt = Math.min(1, dSeam / seam)
        if (wgt <= 0.02) continue
        const tt = t0 + ((((t - t0) % span) + span) % span)
        blended.push({ pt: geom.fn(p0, tt), t: tt, w: wgt })
      }
    }
  } else {
    for (let i = 0; i < K; i++) {
      const t = t0 + ((i + 0.5) / K) * span
      if (t >= lo && t <= hi) continue
      const dSeam = t < lo ? lo - t : t - hi
      const wgt = Math.min(1, dSeam / seam)
      if (wgt <= 0.02) continue
      blended.push({ pt: geom.fn(p0, t), t, w: wgt })
    }
  }
  if (blended.length < Math.max(4, p0.length)) return null

  const newParams = refitFamily(curve, spec, blended)
  if (!newParams || !newParams.every(Number.isFinite)) return null

  // Acceptance is judged on how well the refit explains the INK — the ink is
  // the user's intent; a large deliberate reshape is fine, a family that
  // cannot follow the redrawn part (garbage) is not. Ink residuals must be
  // measured against the NEW curve (re-projected): the old-curve projection
  // parameter is meaningless after e.g. a center shift.
  const newCurve: FittedCurve = { ...curve, params: newParams }
  const newGeom = geometryOf(newCurve, spec) ?? geom
  let inkSS = 0
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let i = 0; i < blended.length; i++) {
    const bPt = blended[i]
    minX = Math.min(minX, bPt.pt.x); maxX = Math.max(maxX, bPt.pt.x)
    minY = Math.min(minY, bPt.pt.y); maxY = Math.max(maxY, bPt.pt.y)
    if (i >= inkCount) continue
    if (explicit) {
      const q = newGeom.fn(newParams, bPt.pt.x)
      inkSS += (q.y - bPt.pt.y) * (q.y - bPt.pt.y)
    } else {
      const dist = nearestInGeometry(newGeom, newParams, bPt.pt).dist
      inkSS += dist * dist
    }
  }
  const error = Math.sqrt(inkSS / inkCount)
  if (!Number.isFinite(error)) return null
  const diag = Math.max(Math.hypot(maxX - minX, maxY - minY), 1e-9)
  if (error > Math.max(3 * Math.max(curve.error, 1e-9), 0.02 * diag)) return null
  return { params: newParams, error }
}

function refitFamily(
  curve: FittedCurve,
  spec: ModelSpec,
  blended: Blended[],
): number[] | null {
  const p0 = curve.params
  const xs = blended.map(b => b.pt.x)
  const ys = blended.map(b => b.pt.y)
  const ws = blended.map(b => b.w)
  const pts = blended.map(b => b.pt)

  switch (curve.modelId) {
    case 'line': return polyfit(xs, ys, 1, ws)
    case 'poly2': return polyfit(xs, ys, 2, ws)
    case 'poly3': return polyfit(xs, ys, 3, ws)
    case 'poly4': return polyfit(xs, ys, 4, ws)
    case 'vline': {
      let sx = 0, sw = 0
      for (const b of blended) { sx += b.w * b.pt.x; sw += b.w }
      return sw > 0 ? [sx / sw] : null
    }
    case 'circle': {
      const c = fitCircle(pts, ws)
      return c ? [c.cx, c.cy, c.r] : null
    }
    case 'ellipse': {
      const conic = fitConic(pts, ws)
      if (!conic) return null
      const [A, B, C] = conic
      return B * B - 4 * A * C < 0 ? conic : null
    }
    case 'fourier': {
      const N = Math.floor((p0.length - 2) / 4)
      if (N < 1) return null
      // weighted linear LS per coordinate on basis [1, cos nt, sin nt]
      const rows: number[][] = []
      for (const b of blended) {
        const sw = Math.sqrt(b.w)
        const row = new Array<number>(1 + 2 * N)
        row[0] = sw
        for (let nH = 1; nH <= N; nH++) {
          row[2 * nH - 1] = Math.cos(nH * b.t) * sw
          row[2 * nH] = Math.sin(nH * b.t) * sw
        }
        rows.push(row)
      }
      const cx = linearLeastSquares(rows, blended.map(b => b.pt.x * Math.sqrt(b.w)))
      const cy = linearLeastSquares(rows, blended.map(b => b.pt.y * Math.sqrt(b.w)))
      if (!cx || !cy) return null
      const out: number[] = [cx[0], cy[0]]
      for (let nH = 1; nH <= N; nH++) {
        out.push(cx[2 * nH - 1], cx[2 * nH], cy[2 * nH - 1], cy[2 * nH])
      }
      return out
    }
    default: {
      // nonlinear families: LM warm-started from the current params, matching
      // each blended point at its own parameter value
      const geom = geometryOf(curve, spec)
      if (!geom) return null
      const residuals = (p: number[]): number[] => {
        const out: number[] = []
        for (const b of blended) {
          const q = geom.fn(p, b.t)
          if (spec.kind === 'explicit') {
            out.push(b.w * (q.y - b.pt.y))
          } else {
            out.push(b.w * (q.x - b.pt.x), b.w * (q.y - b.pt.y))
          }
        }
        return out
      }
      const res = levenbergMarquardt(residuals, p0.slice(), 60)
      if (!res) return null
      if (curve.modelId === 'polarRose') res.params[1] = Math.round(p0[1])
      return res.params
    }
  }
}

// ---------------------------------------------------------------------------
// snapParams
// ---------------------------------------------------------------------------

/** phase-like param indices per model (snapped to the π/6 grid first) */
const PHASE_PARAMS: Record<string, number[]> = {
  sine: [2],
  polarRose: [2],
}

/** params eligible for snapping; undefined = all */
const SNAP_MASK: Record<string, number[] | null> = {
  ellipse: null,       // normalized conic coefficients — snapping distorts
  fourier: [0, 1],     // only the center; harmonics are shape-critical
}

/**
 * Candidate nice value for `v`.
 *
 * `absolute` widens the search to an absolute floor (so 0.004 can reach 0).
 * That is only safe when the caller can verify the snap geometrically — a
 * numerically tiny parameter may still dominate the curve's shape (a cubic's
 * leading coefficient of 0.018 moves it by 4 units at x = 6).
 */
function trySnap(v: number, phaseLike: boolean, absolute: boolean): number | null {
  const tol = absolute ? Math.max(0.015 * Math.abs(v), 0.02) : 0.015 * Math.abs(v)
  if (phaseLike) {
    const grid = Math.PI / 6
    const s = Math.round(v / grid) * grid
    if (Math.abs(v - s) <= tol) return s
  }
  for (const grid of [1, 0.5, 0.25]) {
    const s = Math.round(v / grid) * grid
    if (Math.abs(v - s) <= tol) return s
  }
  return null
}

/** Sample a model's curve at fixed parameter values, for geometric comparison. */
function sampleModel(
  modelId: string,
  spec: ModelSpec,
  domain: [number, number] | null,
  params: number[],
  n = 41,
): Vec2[] | null {
  const geom = geometryOf({ modelId, domain, kind: spec.kind } as FittedCurve, spec)
  if (!geom) return null
  const [t0, t1] = geom.dom
  const out: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const p = geom.fn(params, t0 + ((t1 - t0) * i) / (n - 1))
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null
    out.push(p)
  }
  return out
}

/** Largest point-to-corresponding-point displacement between two samplings. */
function maxShift(a: Vec2[], b: Vec2[]): number {
  let m = 0
  for (let i = 0; i < a.length; i++) {
    const d = Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y)
    if (d > m) m = d
  }
  return m
}

function diagOf(pts: Vec2[]): number {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  return Math.hypot(maxX - minX, maxY - minY)
}

/** Context letting snapParams verify a snap's geometric effect before taking it. */
export interface SnapContext {
  spec: ModelSpec
  domain: [number, number] | null
  /** current fit error; a snap smaller than the residual is imperceptible */
  error?: number
}

export function snapParams(
  modelId: string,
  params: number[],
  ctx?: SnapContext,
): { params: number[]; snapped: boolean[] } | null {
  if (modelId in SNAP_MASK && SNAP_MASK[modelId] === null) return null
  const mask = SNAP_MASK[modelId]
  const phase = PHASE_PARAMS[modelId] ?? []
  const out = params.slice()
  const snapped = params.map(() => false)

  // With a spec we can measure what a snap does to the curve and reject any
  // that visibly reshapes it; without one, only relative snapping is safe.
  const base = ctx ? sampleModel(modelId, ctx.spec, ctx.domain, params) : null
  const budget = base
    ? Math.max(0.005 * diagOf(base), 0.5 * Math.max(ctx?.error ?? 0, 0))
    : 0

  let any = false
  for (let i = 0; i < params.length; i++) {
    if (mask && !mask.includes(i)) continue
    if (modelId === 'polarRose' && i === 1) continue // k is already integral
    const v = params[i]
    if (!Number.isFinite(v)) continue
    const s = trySnap(v, phase.includes(i), base !== null)
    if (s === null || Math.abs(s - v) <= 1e-12) continue

    if (base) {
      // Greedy: accept only if the curve — with every snap taken so far —
      // still sits within budget of where it started.
      const trial = out.slice()
      trial[i] = s
      const moved = sampleModel(modelId, ctx!.spec, ctx!.domain, trial)
      if (!moved || maxShift(moved, base) > budget) continue
    }
    out[i] = s
    snapped[i] = true
    any = true
  }
  return any ? { params: out, snapped } : null
}

// ===========================================================================
// applyFeatureEdit — state a FEATURE, not a parameter
//
//   "Put this zero at x = 2."   "Put the maximum at (-1, 5)."
//
// The readouts analyzeCurve produces become editable: name a special point,
// name where it should be, and the curve changes to satisfy that while moving
// as little as possible otherwise.
//
// Three layers, in order of preference:
//
//   1. POLYNOMIALS get an exact linear solve. f(a) = 0, f(0) = b, f'(a) = 0
//      and f''(a) = 0 are all LINEAR in the coefficients, so the whole edit —
//      moved feature, pinned features, and the shape conditions below — is one
//      equality-constrained least-squares problem with a closed-form KKT
//      solution. The metric minimised is ∫(p_new − p_old)² over the curve's own
//      domain, i.e. the curve's actual displacement, not an arbitrary norm on
//      the coefficients. That is what picks the leading coefficient when three
//      zeros of a cubic leave exactly one degree of freedom: a(x−r₁)(x−r₂)(x−r₃)
//      with a chosen to sit closest to the curve the teacher already drew.
//
//   2. THE OTHER FAMILIES get direct algebra per feature — a gaussian's peak is
//      (b, a + d), so "peak at (2, 5)" is b = 2 and a = 5 − d and nothing else.
//
//   3. ANYTHING ELSE (typed expressions with free constants, chiefly) falls back
//      to damped Gauss–Newton on the same residuals — f(a), f'(a), f''(a) — with
//      dragCurvePoint's anchor scheme: samples of the current curve weighted
//      1 − exp(−d²/2σ²) away from the feature, so the curve is free where the
//      edit is and increasingly pinned everywhere else. Flagged exact: false.
//
// REFUSALS are as much of the feature as the solving. A parabola cannot have
// three zeros; a gaussian has one turning point; a cubic's maximum, minimum and
// inflection are one rigid arrangement, not three free choices. Those are
// refused with a sentence a teacher can read — never quietly approximated.
// ===========================================================================

const FD1 = Math.cbrt(Number.EPSILON)
const FD2 = Math.pow(Number.EPSILON, 0.25)

/** Nominal degree per polynomial family (params are ascending coefficients). */
const POLY_DEGREE: Record<string, number> = { line: 1, poly2: 2, poly3: 3, poly4: 4 }

/** How many of each feature a family can EVER have. The basis of the refusals. */
interface FamilyCaps { zeros: number; extrema: number; inflections: number }

const CAPS: Record<string, FamilyCaps> = {
  line: { zeros: 1, extrema: 0, inflections: 0 },
  poly2: { zeros: 2, extrema: 1, inflections: 0 },
  poly3: { zeros: 3, extrema: 2, inflections: 1 },
  poly4: { zeros: 4, extrema: 3, inflections: 2 },
  gauss: { zeros: 2, extrema: 1, inflections: 2 },
  abs: { zeros: 2, extrema: 1, inflections: 0 },
  exp: { zeros: 1, extrema: 0, inflections: 0 },
  sqrt: { zeros: 1, extrema: 0, inflections: 0 },
  cbrt: { zeros: 1, extrema: 0, inflections: 1 },
  power: { zeros: 2, extrema: 1, inflections: 0 },
  logistic: { zeros: 1, extrema: 0, inflections: 1 },
  // a logarithm crosses once and never turns; a hyperbola crosses once (never,
  // when its horizontal asymptote is the axis itself) and never turns either
  log: { zeros: 1, extrema: 0, inflections: 0 },
  recip: { zeros: 1, extrema: 0, inflections: 0 },
}

/** Why a family with a single turning point cannot be given another. */
const ONE_TURN: Record<string, string> = {
  gauss: 'A gaussian has exactly one turning point — its peak — so it cannot have a second maximum or minimum.',
  poly2: 'A parabola has exactly one turning point — its vertex — so it cannot have a second maximum or minimum.',
  abs: 'An absolute-value graph has exactly one turning point — its corner — so it cannot have a second maximum or minimum.',
  power: 'A power curve has exactly one turning point — its cusp — so it cannot have a second maximum or minimum.',
}

const FEATURE_WEIGHT = 24
const FEATURE_ANCHORS = 28
const FEATURE_RIDGE = 0.02
const FEATURE_ITERS = 60
/** How far from its reported position a feature may be and still be "that one". */
const MATCH_FRAC = 0.05

/** One condition the edited curve must satisfy. */
interface Req {
  kind: SpecialPointKind
  x: number
  y: number
  /** whether the feature's HEIGHT is constrained too (a zero's never is) */
  useY: boolean
}

function reqCost(r: Req): number {
  if (r.kind === 'zero' || r.kind === 'y-intercept') return 1
  return r.useY ? 2 : 1
}

function num(v: number): string {
  if (!Number.isFinite(v)) return String(v)
  const r = Number(v.toPrecision(6))
  return Object.is(r, -0) ? '0' : String(r)
}

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']
function word(n: number): string { return WORDS[n] ?? String(n) }
function times(n: number): string {
  return n === 1 ? 'once' : n === 2 ? 'twice' : `${word(n)} times`
}

function article(name: string): string {
  return /^[aeiou]/i.test(name) ? 'an' : 'a'
}

/** Human label for a feature kind, as it reads mid-sentence. */
function kindLabel(k: SpecialPointKind): string {
  switch (k) {
    case 'zero': return 'zero'
    case 'y-intercept': return 'y-intercept'
    case 'maximum': return 'maximum'
    case 'minimum': return 'minimum'
    case 'inflection': return 'inflection point'
    case 'extreme': return 'edge point'
    case 'petal-tip': return 'petal tip'
    case 'hole': return 'hole'
    case 'intersection': return 'intersection'
  }
}

// ---------------------------------------------------------------------------
// Polynomial helpers: exact change of variable, and constraint rows
// ---------------------------------------------------------------------------

function polyMulCoeffs(a: number[], b: number[]): number[] {
  const out = new Array<number>(a.length + b.length - 1).fill(0)
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j]
  }
  return out
}

/**
 * Re-express Σ c_j x^j in u = (x − m)/h, and back. The whole polynomial solve
 * runs in u, where the domain is [−1, 1] and the Gram matrix below is a fixed,
 * well-conditioned constant — a quartic on [−40, 60] solved directly in x has
 * normal equations that lose every digit it has.
 */
function polyToU(cx: number[], m: number, h: number): number[] {
  const out = new Array<number>(cx.length).fill(0)
  let acc: number[] = [1]
  for (let j = 0; j < cx.length; j++) {
    for (let i = 0; i < acc.length; i++) out[i] += cx[j] * acc[i]
    if (j < cx.length - 1) acc = polyMulCoeffs(acc, [m, h])
  }
  return out
}

function polyFromU(cu: number[], m: number, h: number): number[] {
  const out = new Array<number>(cu.length).fill(0)
  let acc: number[] = [1]
  for (let j = 0; j < cu.length; j++) {
    for (let i = 0; i < acc.length; i++) out[i] += cu[j] * acc[i]
    if (j < cu.length - 1) acc = polyMulCoeffs(acc, [-m / h, 1 / h])
  }
  return out
}

function powRow(n: number, u: number): number[] {
  const row = new Array<number>(n + 1)
  let v = 1
  for (let k = 0; k <= n; k++) { row[k] = v; v *= u }
  return row
}

function derivRow(n: number, u: number): number[] {
  const row = new Array<number>(n + 1).fill(0)
  let v = 1
  for (let k = 1; k <= n; k++) { row[k] = k * v; v *= u }
  return row
}

function deriv2Row(n: number, u: number): number[] {
  const row = new Array<number>(n + 1).fill(0)
  let v = 1
  for (let k = 2; k <= n; k++) { row[k] = k * (k - 1) * v; v *= u }
  return row
}

interface Row { row: number[]; rhs: number }

/** The linear conditions one Req imposes on a polynomial's u-coefficients. */
function reqRows(r: Req, n: number, m: number, h: number): Row[] {
  const u = (r.x - m) / h
  switch (r.kind) {
    case 'zero':
      return [{ row: powRow(n, u), rhs: 0 }]
    case 'y-intercept':
      return [{ row: powRow(n, (0 - m) / h), rhs: r.y }]
    case 'maximum':
    case 'minimum': {
      const rows: Row[] = [{ row: derivRow(n, u), rhs: 0 }]
      if (r.useY) rows.push({ row: powRow(n, u), rhs: r.y })
      return rows
    }
    case 'inflection': {
      const rows: Row[] = [{ row: deriv2Row(n, u), rhs: 0 }]
      if (r.useY) rows.push({ row: powRow(n, u), rhs: r.y })
      return rows
    }
    default:
      return []
  }
}

/**
 * Add rows one at a time, keeping only those that say something new.
 *
 * A row that is a linear combination of the ones already accepted is either
 * redundant (its right-hand side agrees — drop it, nothing is lost) or
 * contradictory (it does not — the request cannot be met at all). Gram–Schmidt
 * answers both questions at once: orthogonalise the row against the accepted
 * basis and carry the right-hand side through the same operations.
 */
class RowSet {
  private basis: Row[] = []
  readonly rows: Row[] = []
  /** null = accepted or redundant; a string = the row contradicts earlier ones */
  add(cand: Row): 'accepted' | 'redundant' | 'contradiction' {
    let norm = 0
    for (const v of cand.row) norm += v * v
    norm = Math.sqrt(norm)
    if (!(norm > 0)) return 'redundant'
    let r = cand.row.map(v => v / norm)
    let rhs = cand.rhs / norm
    for (const b of this.basis) {
      let dot = 0
      for (let i = 0; i < r.length; i++) dot += r[i] * b.row[i]
      if (dot === 0) continue
      r = r.map((v, i) => v - dot * b.row[i])
      rhs -= dot * b.rhs
    }
    let rn = 0
    for (const v of r) rn += v * v
    rn = Math.sqrt(rn)
    if (rn < 1e-9) {
      return Math.abs(rhs) <= 1e-9 * (1 + Math.abs(cand.rhs / norm))
        ? 'redundant'
        : 'contradiction'
    }
    this.basis.push({ row: r.map(v => v / rn), rhs: rhs / rn })
    this.rows.push({ row: cand.row.slice(), rhs: cand.rhs })
    return 'accepted'
  }
  get size(): number { return this.rows.length }
}

/**
 * Minimise ∫₋₁¹ (p_new − p_old)² du subject to A·c = b, in closed form.
 *
 * KKT: the correction is e = G⁻¹Aᵀ(A G⁻¹ Aᵀ)⁻¹ (b − A c₀), where G is the Gram
 * matrix of the monomial basis. Constraints are met EXACTLY (up to rounding);
 * every remaining degree of freedom goes to keeping the curve where it was.
 */
function solveConstrained(cu0: number[], rows: Row[]): number[] | null {
  const m = cu0.length
  if (rows.length === 0) return cu0.slice()
  if (rows.length > m) return null
  const G: number[][] = Array.from({ length: m }, (_, j) =>
    Array.from({ length: m }, (_, k) => ((j + k) % 2 === 0 ? 2 / (j + k + 1) : 0)),
  )
  // X = G⁻¹Aᵀ, one column per constraint
  const X: number[][] = []
  for (const r of rows) {
    const x = solveLinearSystem(G.map(row => row.slice()), r.row.slice())
    if (!x) return null
    X.push(x)
  }
  const k = rows.length
  const S: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0))
  const d = new Array<number>(k).fill(0)
  for (let i = 0; i < k; i++) {
    let ac = 0
    for (let j = 0; j < m; j++) ac += rows[i].row[j] * cu0[j]
    d[i] = rows[i].rhs - ac
    for (let j = 0; j < k; j++) {
      let s = 0
      for (let q = 0; q < m; q++) s += rows[i].row[q] * X[j][q]
      S[i][j] = s
    }
  }
  const mu = solveLinearSystem(S, d)
  if (!mu) return null
  const out = cu0.slice()
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < m; j++) out[j] += mu[i] * X[i][j]
  }
  return out.every(Number.isFinite) ? out : null
}

// ---------------------------------------------------------------------------
// Closed-form feature moves for the non-polynomial families
// ---------------------------------------------------------------------------

/**
 * Direct algebra, family by family. Returns null when this family has no closed
 * form for this feature (the caller then goes numeric).
 *
 * `yGiven` distinguishes "put the peak at x = 2" (height left alone) from "put
 * the peak at (2, 5)"; unspecified coordinates always default to the feature's
 * current ones, so an edit only ever moves the axis it was asked about.
 */
function closedFormFeature(
  curve: FittedCurve,
  spec: ModelSpec,
  kind: SpecialPointKind,
  tx: number,
  ty: number,
  matched: SpecialPoint,
  yGiven: boolean,
): number[] | null {
  const p = curve.params.slice()
  switch (curve.modelId) {
    case 'sine': {
      const [a, b, c, d] = p
      if (!(Math.abs(b) > 1e-12) || !(Math.abs(a) > 1e-12)) return null
      // phase putting b·tx + c at theta0, chosen k nearest the current phase
      const phaseFor = (theta0: number): number => {
        const raw = theta0 - b * tx
        return raw + TWO_PI * Math.round((c - raw) / TWO_PI)
      }
      const sgn = a >= 0 ? 1 : -1
      if (kind === 'maximum' || kind === 'minimum') {
        const wantMax = kind === 'maximum'
        // extreme value is d ± |a|: prefer resizing the amplitude, and only
        // move the midline when the requested height is on its wrong side
        let mag = wantMax ? ty - d : d - ty
        let nd = d
        if (!(mag > 1e-12)) {
          mag = Math.abs(a)
          nd = wantMax ? ty - mag : ty + mag
        }
        const theta0 = (wantMax ? 1 : -1) * sgn * (Math.PI / 2)
        return [sgn * mag, b, phaseFor(theta0), nd]
      }
      if (kind === 'zero') {
        const S = -d / a
        if (!(Math.abs(S) <= 1)) return null
        const base = Math.asin(S)
        // keep the wave running the same way through this zero as it does now
        const cur = b * matched.pos.x + c
        const rising = Math.cos(cur) >= 0
        const cands = [base, Math.PI - base]
        const pick = cands.find(t => (Math.cos(t) >= 0) === rising) ?? base
        return [a, b, phaseFor(pick), d]
      }
      if (kind === 'inflection') {
        // a sinusoid's inflections are exactly its midline crossings
        const nd = yGiven ? ty : d
        const cur = b * matched.pos.x + c
        const rising = Math.cos(cur) >= 0
        const theta0 = rising ? 0 : Math.PI
        return [a, b, phaseFor(theta0), nd]
      }
      return null
    }
    case 'gauss': {
      const [a, b, c, d] = p
      if (!(Math.abs(a) > 1e-12) || !(Math.abs(c) > 1e-12)) return null
      if (kind === 'maximum' || kind === 'minimum') {
        // the single peak: (b, a + d)
        const na = ty - d
        if (Math.abs(na) > 1e-12 && (na > 0) === (a > 0)) return [na, tx, c, d]
        // the requested height is on the wrong side of the baseline for a bump
        // of this sign — keep the height and move the baseline instead
        return [a, tx, c, ty - a]
      }
      if (kind === 'inflection') {
        // inflections sit at b ± |c|/√2, so the x fixes the width outright
        const w = Math.abs(tx - b)
        if (!(w > 1e-12)) return null
        const nc = (c >= 0 ? 1 : -1) * Math.SQRT2 * w
        let na = a
        if (yGiven) {
          const want = (ty - d) * Math.exp(0.5)
          if (Math.abs(want) > 1e-12) na = want
        }
        return [na, b, nc, d]
      }
      if (kind === 'zero') {
        const R = -d / a
        if (!(R > 0) || !(R < 1)) return null
        const w = Math.abs(tx - b)
        if (!(w > 1e-12)) return null
        const nc = (c >= 0 ? 1 : -1) * (w / Math.sqrt(-Math.log(R)))
        return [a, b, nc, d]
      }
      return null
    }
    case 'abs': {
      const [a, b] = p
      if (!(Math.abs(a) > 1e-12)) return null
      if (kind === 'maximum' || kind === 'minimum') return [a, tx, ty]
      if (kind === 'zero') {
        const u = Math.abs(tx - b)
        if (!(u > 1e-12)) return null
        return [a, b, -a * u]
      }
      return null
    }
    case 'power': {
      const [a, b, , e] = p
      if (!(Math.abs(a) > 1e-12)) return null
      if (kind === 'maximum' || kind === 'minimum') return [a, tx, ty, e]
      if (kind === 'zero') {
        const u = Math.abs(tx - b)
        if (!(u > 1e-12)) return null
        return [a, b, -a * Math.pow(u, e), e]
      }
      return null
    }
    case 'exp': {
      const [a, b] = p
      if (!(Math.abs(a) > 1e-12) || !(Math.abs(b) > 1e-12)) return null
      if (kind === 'zero') {
        const c = -a * Math.exp(b * tx)
        return Number.isFinite(c) ? [a, b, c] : null
      }
      return null
    }
    case 'sqrt': {
      const [a, b] = p
      if (!(Math.abs(a) > 1e-12)) return null
      if (kind === 'zero') {
        if (!(tx > b)) return null
        return [a, b, -a * Math.sqrt(tx - b)]
      }
      return null
    }
    case 'cbrt': {
      const [a, b] = p
      if (!(Math.abs(a) > 1e-12)) return null
      if (kind === 'zero') return [a, b, -a * Math.cbrt(tx - b)]
      // the branch point IS the inflection: an exact rigid translation
      if (kind === 'inflection') return [a, tx, ty]
      return null
    }
    case 'logistic': {
      const [a, b, , d] = p
      if (!(Math.abs(a) > 1e-12) || !(Math.abs(b) > 1e-12)) return null
      if (kind === 'inflection') return [a, b, tx, yGiven ? ty - a / 2 : d]
      if (kind === 'zero') {
        if (!(Math.abs(d) > 1e-12)) return null
        const E = -a / d - 1
        if (!(E > 0)) return null
        return [a, b, tx + Math.log(E) / b, d]
      }
      return null
    }
    case 'circle': {
      const [cx, cy, r] = p
      if (!(r > 0)) return null
      if (kind === 'extreme') {
        // move one side of the circle, holding the opposite side still: the
        // centre and radius both follow, exactly, from the two edges
        const horizontal = matched.label === 'left' || matched.label === 'right'
        if (horizontal) {
          const other = matched.label === 'left' ? cx + r : cx - r
          const nr = Math.abs(tx - other) / 2
          if (!(nr > 1e-12)) return null
          return [(tx + other) / 2, cy, nr]
        }
        const other = matched.label === 'bottom' ? cy + r : cy - r
        const nr = Math.abs(ty - other) / 2
        if (!(nr > 1e-12)) return null
        return [cx, (ty + other) / 2, nr]
      }
      if (kind === 'zero') {
        // x-axis crossings at cx ± √(r² − cy²): hold the other one and the
        // height of the centre, and both cx and r follow
        const disc = r * r - cy * cy
        if (!(disc > 0)) return [tx, cy, r] // tangent to the axis: slide across
        const s = Math.sqrt(disc)
        const other = matched.pos.x >= cx ? cx - s : cx + s
        const hw = Math.abs(tx - other) / 2
        if (!(hw > 1e-12)) return null
        return [(tx + other) / 2, cy, Math.hypot(hw, cy)]
      }
      return null
    }
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// The numeric fallback: damped Gauss–Newton on the feature residuals
// ---------------------------------------------------------------------------

/**
 * Everything without an algebraic answer — chiefly typed expressions, whose
 * free constants have no known meaning — is solved the way dragCurvePoint
 * solves a drag: the requested conditions as heavily weighted residuals, plus
 * samples of the CURRENT curve weighted 1 − exp(−d²/2σ²) so the curve is free
 * near the feature and anchored away from it, plus a ridge on the parameters.
 */
function numericFeatureEdit(
  spec: ModelSpec,
  p0: number[],
  dom: [number, number],
  reqs: Req[],
  focusX: number,
): number[] | null {
  const ev = spec.evalExplicit
  if (!ev) return null
  const F = (p: number[], x: number): number => {
    let v: number
    try { v = ev.call(spec, p, x) } catch { return Number.NaN }
    return typeof v === 'number' ? v : Number.NaN
  }
  const d1 = (p: number[], x: number): number => {
    const h = FD1 * Math.max(1, Math.abs(x))
    return (F(p, x + h) - F(p, x - h)) / (2 * h)
  }
  const d2f = (p: number[], x: number): number => {
    const h = FD2 * Math.max(1, Math.abs(x))
    return (F(p, x + h) - 2 * F(p, x) + F(p, x - h)) / (h * h)
  }

  const [lo, hi] = dom
  const span = hi - lo
  if (!(span > 0)) return null

  // anchors + the curve's own vertical scale
  const xs: number[] = []
  const ws: number[] = []
  const y0s: number[] = []
  const sigma = 0.15 * span
  let yScale = 0
  for (let i = 0; i < FEATURE_ANCHORS; i++) {
    const x = lo + (span * i) / (FEATURE_ANCHORS - 1)
    const y = F(p0, x)
    if (!Number.isFinite(y)) continue
    const d = x - focusX
    xs.push(x)
    y0s.push(y)
    ws.push(1 - Math.exp(-(d * d) / (2 * sigma * sigma)))
    yScale = Math.max(yScale, Math.abs(y))
  }
  if (xs.length < 3) return null
  if (!(yScale > 0)) yScale = 1
  const sc1 = yScale / span
  const sc2 = yScale / (span * span)
  const pScale = p0.map(v => Math.max(1, Math.abs(v)))

  const bound = (v: number): number => (Number.isFinite(v) ? v : 1e3)

  /** The requested conditions alone, scaled to be dimensionless. */
  const cons = (p: number[]): number[] => {
    const out: number[] = []
    for (const r of reqs) {
      switch (r.kind) {
        case 'zero':
          out.push(bound(F(p, r.x) / yScale))
          break
        case 'y-intercept':
          out.push(bound((F(p, 0) - r.y) / yScale))
          break
        case 'maximum':
        case 'minimum':
          out.push(bound(d1(p, r.x) / sc1))
          if (r.useY) out.push(bound((F(p, r.x) - r.y) / yScale))
          break
        case 'inflection':
          out.push(bound(d2f(p, r.x) / sc2))
          if (r.useY) out.push(bound((F(p, r.x) - r.y) / yScale))
          break
        default:
          break
      }
    }
    return out
  }

  /**
   * Which way a turning point turns. f'(a) = 0 says a curve is level at a, not
   * that it has a maximum there — and a family whose every parameter moves the
   * whole curve will happily walk from one to the other on the way to a level
   * point (a·sin x + b·x + c reaches a level point at the right height with a
   * of either sign; only a > 0 makes it the maximum that was asked for). The
   * equality solve cannot see the difference, so the second derivative is
   * pushed to the correct sign by a one-sided residual: zero once the curve is
   * turning the right way, and a growing pull while it is not.
   */
  const character = (p: number[]): number => {
    let worst = 0
    for (const r of reqs) {
      if (r.kind !== 'maximum' && r.kind !== 'minimum') continue
      const s = r.kind === 'maximum' ? 1 : -1
      const v = s * bound(d2f(p, r.x) / sc2) + 0.05
      if (v > worst) worst = v
    }
    return worst
  }

  /**
   * How far the curve reaches vertically — its own scale, sampled.
   *
   * The polynomial solve keeps the leading coefficient when a turning point
   * moves, so the curve slides rather than reshapes. The general families need
   * the same protection and have no leading coefficient to hold, so hold the
   * observable instead. Without it, "raise this local maximum by 1" is answered
   * by the least-squares optimum of FLATTENING the whole curve to a horizontal
   * line through the requested height — every condition satisfied, less total
   * displacement than any honest answer, and nothing left of the graph that was
   * drawn. Holding the range costs a fraction of a unit and rules that out.
   */
  const rangeOf = (p: number[]): number => {
    let mn = Infinity
    let mx = -Infinity
    for (const x of xs) {
      const y = F(p, x)
      if (!Number.isFinite(y)) continue
      if (y < mn) mn = y
      if (y > mx) mx = y
    }
    return mx > mn ? mx - mn : 0
  }
  const holdScale = reqs.some(
    r => r.kind === 'maximum' || r.kind === 'minimum' || r.kind === 'inflection',
  )
  const range0 = Math.max(rangeOf(p0), 1e-9)
  const scaleCost = (p: number[]): number =>
    holdScale ? (FEATURE_WEIGHT / 2) * ((rangeOf(p) - range0) / range0) : 0

  const residuals = (p: number[]): number[] => {
    const out: number[] = []
    for (const v of cons(p)) out.push(FEATURE_WEIGHT * v)
    out.push(FEATURE_WEIGHT * character(p))
    out.push(scaleCost(p))
    for (let i = 0; i < xs.length; i++) {
      const y = F(p, xs[i])
      out.push(Number.isFinite(y) ? (ws[i] * (y - y0s[i])) / yScale : 0)
    }
    for (let j = 0; j < p.length; j++) {
      out.push((FEATURE_RIDGE * (p[j] - p0[j])) / pScale[j])
    }
    return out
  }

  // The anchors decide WHERE among the curves that satisfy the request to land;
  // they must not decide WHETHER it is satisfied. A soft weight always trades a
  // little of the constraint away for a little anchor — a sinusoid's zero came
  // to rest 5e-4 from where it was asked, which is visible on a graph and is
  // not what "put the zero at x = 2" means. So every candidate is finished by
  // projecting onto the constraint manifold with minimum-norm steps: the
  // conditions become exact, and the parameters move as little as the geometry
  // allows on the way.
  //
  // Two starts, because these families have no local degrees of freedom: every
  // parameter of a·sin(x) + b·x + c moves the whole curve, so the damped solve
  // can slide into a basin where a has changed sign and the "maximum" it lands
  // on is really a minimum. Projecting straight from the current parameters
  // stays in the basin the curve is already in; the anchor cost then says which
  // of the two answers actually kept the curve.
  const starts: number[][] = []
  const res = levenbergMarquardt(residuals, p0.slice(), FEATURE_ITERS)
  if (res && res.params.every(Number.isFinite)) starts.push(res.params)
  starts.push(p0.slice())

  const anchorCost = (p: number[]): number => {
    let s = 0
    for (let i = 0; i < xs.length; i++) {
      const y = F(p, xs[i])
      if (!Number.isFinite(y)) return Infinity
      const d = (ws[i] * (y - y0s[i])) / yScale
      s += d * d
    }
    const sc = scaleCost(p)
    return s + sc * sc
  }
  const worstCon = (p: number[]): number => {
    let m = 0
    for (const v of cons(p)) m = Math.max(m, Math.abs(v))
    return m
  }

  let best: number[] | null = null
  let bestFeasible = false
  let bestScore = Infinity
  for (const s of starts) {
    const p = projectOntoConstraints(cons, s, pScale)
    if (!p.every(Number.isFinite)) continue
    const con = worstCon(p)
    // a level point of the wrong character is not the feature that was asked
    // for, however exactly it meets f'(a) = 0
    const feasible = con <= 1e-8 && character(p) <= 0.05
    const score = feasible ? anchorCost(p) : con
    if (best === null || (feasible && !bestFeasible) ||
        (feasible === bestFeasible && score < bestScore)) {
      best = p
      bestFeasible = feasible
      bestScore = score
    }
  }
  return best
}

/**
 * Newton on the constraints alone, each step the smallest that meets them:
 * Δp = D Jᵀ (J D Jᵀ)⁻¹ (−r), with D scaling each parameter by its own size.
 * This is the same minimum-change principle the polynomial KKT solve uses,
 * applied where the constraints are not linear. Backtracks rather than
 * diverging, and never returns a point worse than the one it was given.
 */
function projectOntoConstraints(
  cons: (p: number[]) => number[],
  start: number[],
  pScale: number[],
  iters = 12,
): number[] {
  const inf = (r: number[]): number => {
    let m = 0
    for (const v of r) m = Math.max(m, Math.abs(v))
    return m
  }
  const m = start.length
  let p = start.slice()
  let best = p.slice()
  let bestN = inf(cons(p))
  if (!Number.isFinite(bestN)) return best

  for (let it = 0; it < iters && bestN > 1e-12; it++) {
    const r = cons(p)
    const k = r.length
    if (k === 0 || k > m) break
    const J: number[][] = Array.from({ length: k }, () => new Array<number>(m).fill(0))
    let ok = true
    for (let j = 0; j < m && ok; j++) {
      const h = 1e-6 * pScale[j]
      const pj = p.slice()
      pj[j] += h
      const rj = cons(pj)
      if (rj.length !== k) { ok = false; break }
      for (let i = 0; i < k; i++) {
        const v = (rj[i] - r[i]) / h
        if (!Number.isFinite(v)) { ok = false; break }
        J[i][j] = v
      }
    }
    if (!ok) break

    const A: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0))
    for (let i = 0; i < k; i++) {
      for (let l = i; l < k; l++) {
        let s = 0
        for (let j = 0; j < m; j++) s += J[i][j] * J[l][j] * pScale[j] * pScale[j]
        A[i][l] = s
        A[l][i] = s
      }
    }
    let tr = 0
    for (let i = 0; i < k; i++) tr += A[i][i]
    for (let i = 0; i < k; i++) A[i][i] += 1e-10 * (tr / k + 1)
    const lam = solveLinearSystem(A, r.map(v => -v))
    if (!lam) break
    const step = new Array<number>(m).fill(0)
    for (let j = 0; j < m; j++) {
      let s = 0
      for (let i = 0; i < k; i++) s += J[i][j] * lam[i]
      step[j] = s * pScale[j] * pScale[j]
    }
    let taken = false
    let a = 1
    for (let t = 0; t < 7; t++, a /= 2) {
      const trial = p.map((v, j) => v + a * step[j])
      if (!trial.every(Number.isFinite)) continue
      const n = inf(cons(trial))
      if (Number.isFinite(n) && n < bestN) {
        p = trial
        bestN = n
        best = trial.slice()
        taken = true
        break
      }
    }
    if (!taken) break
  }
  return best
}

// ---------------------------------------------------------------------------
// Reporting what else moved
// ---------------------------------------------------------------------------

/**
 * Features that shifted as a side effect. Matched kind by kind in left-to-right
 * order; when a kind's COUNT changed (a curve gained a zero, lost an extremum)
 * every point of that kind is reported, because no honest pairing exists.
 */
function movedFeatures(
  before: SpecialPoint[],
  after: SpecialPoint[],
  edited: SpecialPointKind,
  tx: number,
  ty: number,
  tol: number,
): SpecialPoint[] {
  const group = (list: SpecialPoint[]): Map<string, SpecialPoint[]> => {
    const m = new Map<string, SpecialPoint[]>()
    for (const p of list) {
      const g = m.get(p.kind)
      if (g) g.push(p)
      else m.set(p.kind, [p])
    }
    return m
  }
  const b = group(before)
  const a = group(after)
  const out: SpecialPoint[] = []
  const isEdited = (p: SpecialPoint): boolean =>
    p.kind === edited &&
    Math.abs(p.pos.x - tx) <= tol &&
    (edited === 'zero' || Math.abs(p.pos.y - ty) <= tol)

  for (const [kind, list] of a) {
    const prev = b.get(kind) ?? []
    if (prev.length === list.length) {
      for (let i = 0; i < list.length; i++) {
        if (isEdited(list[i])) continue
        const d = Math.hypot(list[i].pos.x - prev[i].pos.x, list[i].pos.y - prev[i].pos.y)
        if (d > tol) out.push(list[i])
      }
    } else {
      for (const p of list) if (!isEdited(p)) out.push(p)
    }
  }
  // kinds that vanished entirely are worth saying too, via their old position
  for (const [kind, list] of b) {
    if ((a.get(kind) ?? []).length === 0 && list.length > 0) {
      for (const p of list) if (!isEdited(p)) out.push(p)
    }
  }
  out.sort((p, q) => p.pos.x - q.pos.x)
  return out.slice(0, 16)
}

// ---------------------------------------------------------------------------
// The entry point
// ---------------------------------------------------------------------------

export function applyFeatureEdit(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  edit: FeatureEdit,
): FeatureEditResult {
  try {
    return featureEdit(curve, models, edit)
  } catch {
    return {
      ok: false,
      reason: 'Something went wrong working that edit out, so the curve is unchanged.',
    }
  }
}

function featureEdit(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  edit: FeatureEdit,
): FeatureEditResult {
  const fail = (
    reason: string,
    nearest?: { params: number[]; domain: [number, number] | null },
  ): FeatureEditResult =>
    nearest && nearest.params.every(Number.isFinite)
      ? { ok: false, reason, nearest }
      : { ok: false, reason }

  const spec = models[curve.modelId]
  if (!spec) return fail('This curve has no model behind it, so its features cannot be moved.')
  const p0 = curve.params.slice()
  if (p0.length === 0) {
    // A typed equation with every number written out has nothing to solve for.
    // Telling the user to "refit" it would be nonsense — there is no fit.
    return fail(
      'This equation has no adjustable constants, so there is nothing to move. ' +
        'Write one in — y = a x^2 gives you a to set — and its features become editable.',
    )
  }
  if (!p0.every(Number.isFinite)) {
    return fail('This curve’s numbers are not usable yet — refit it before moving a feature.')
  }
  const point = edit?.point
  if (!point || !Number.isFinite(point.pos?.x) || !Number.isFinite(point.pos?.y)) {
    return fail('That feature has no position to move from.')
  }
  const to = edit.to ?? {}
  if ((to.x !== undefined && !Number.isFinite(to.x)) ||
      (to.y !== undefined && !Number.isFinite(to.y))) {
    return fail('That target position is not a number.')
  }

  const kind = point.kind
  const name = spec.name.toLowerCase()
  const An = article(name)
  /** "A parabola", "An expression" — the subject of most of the refusals. */
  const Fam = `${An[0].toUpperCase()}${An.slice(1)} ${name}`
  const label = kindLabel(kind)

  // ---- the target -------------------------------------------------------
  if (kind === 'zero' && to.y !== undefined && Math.abs(to.y) > 1e-12) {
    return fail(
      `A zero is where the curve meets the x-axis, so its y is always 0 — it cannot be moved to y = ${num(to.y)}.`,
    )
  }
  if (kind === 'y-intercept' && to.x !== undefined && Math.abs(to.x) > 1e-12) {
    return fail('The y-intercept is where the curve meets x = 0, so it can only move up and down.')
  }
  const tx = kind === 'y-intercept' ? 0 : (to.x ?? point.pos.x)
  const ty = kind === 'zero' ? 0 : (to.y ?? point.pos.y)
  const yGiven = to.y !== undefined

  // ---- the working domain ------------------------------------------------
  // A feature asked for outside the drawn x-range is a request to draw further,
  // not an error: extend the domain so the curve actually reaches the target.
  const explicit = !!spec.evalExplicit
  let outDomain: [number, number] | null =
    curve.domain ? [curve.domain[0], curve.domain[1]] : null
  let work: [number, number] = curve.domain
    ? [curve.domain[0], curve.domain[1]]
    : [-10, 10]
  if (explicit) {
    const margin = 0.05 * Math.max(work[1] - work[0], 1e-9)
    let [lo, hi] = work
    const want = kind === 'y-intercept' ? [0, point.pos.x] : [tx, point.pos.x]
    for (const v of want) {
      if (!Number.isFinite(v)) continue
      if (v < lo) lo = v - margin
      if (v > hi) hi = v + margin
    }
    if (lo !== work[0] || hi !== work[1]) {
      work = [lo, hi]
      outDomain = [lo, hi]
    }
  }
  const span = Math.max(work[1] - work[0], 1e-9)
  const workCurve: FittedCurve = { ...curve, params: p0, domain: explicit ? work : outDomain }

  // ---- does this feature exist? -----------------------------------------
  const before = analyzeCurve(workCurve, models)
  const same = before.filter(q => q.kind === kind)
  const caps = CAPS[curve.modelId]
  if (same.length === 0) {
    if (kind === 'zero') {
      return fail('This curve never crosses the x-axis here, so it has no zero to move.')
    }
    if (kind === 'maximum' || kind === 'minimum') {
      if (caps && caps.extrema === 0) {
        return fail(`${Fam} never turns around, so it has no maximum or minimum to move.`)
      }
      return fail(`This curve has no ${label} to move.`)
    }
    if (kind === 'inflection' && caps && caps.inflections === 0) {
      return fail(`${Fam} never changes concavity, so it has no inflection point.`)
    }
    return fail(`This curve has no ${label} to move.`)
  }
  const closed = kind === 'extreme' || kind === 'petal-tip'
  let matched = same[0]
  let bestD = Infinity
  for (const q of same) {
    const d = closed
      ? Math.hypot(q.pos.x - point.pos.x, q.pos.y - point.pos.y)
      : Math.abs(q.pos.x - point.pos.x)
    if (d < bestD) { bestD = d; matched = q }
  }
  if (bestD > MATCH_FRAC * span + 1e-9) {
    if ((kind === 'maximum' || kind === 'minimum') && caps && same.length >= caps.extrema) {
      return fail(
        ONE_TURN[curve.modelId] ??
        `${Fam} has at most ${times(caps.extrema)} turning point, and it already has ${word(same.length)} — there is no second one to move.`,
      )
    }
    return fail(`This curve has no ${label} near x = ${num(point.pos.x)}, so there is nothing there to move.`)
  }

  // ---- the requested conditions -----------------------------------------
  const feature: Req = {
    kind,
    x: kind === 'y-intercept' ? 0 : tx,
    y: ty,
    useY: kind !== 'zero',
  }
  const pins: Req[] = []
  for (const q of edit.pinned ?? []) {
    if (!q || !Number.isFinite(q.pos?.x) || !Number.isFinite(q.pos?.y)) continue
    if (q.kind === 'extreme' || q.kind === 'petal-tip') continue
    // pinning the very point being moved is not a conflict, just noise
    if (q.kind === kind && Math.abs(q.pos.x - matched.pos.x) <= 1e-9) continue
    pins.push({
      kind: q.kind,
      x: q.kind === 'y-intercept' ? 0 : q.pos.x,
      y: q.kind === 'zero' ? 0 : q.pos.y,
      useY: q.kind !== 'zero',
    })
  }

  const all = [feature, ...pins]
  const distinctXs = (k: SpecialPointKind | 'extremum'): number[] => {
    const xs: number[] = []
    for (const r of all) {
      const hit = k === 'extremum'
        ? r.kind === 'maximum' || r.kind === 'minimum'
        : r.kind === k
      if (!hit) continue
      if (!xs.some(v => Math.abs(v - r.x) <= 1e-9)) xs.push(r.x)
    }
    return xs
  }

  // ---- refusals that no amount of solving can get around ------------------
  if (caps) {
    const zs = distinctXs('zero').length
    if (zs > caps.zeros) {
      return fail(
        `${Fam} crosses the x-axis at most ${times(caps.zeros)}, so it cannot have ${word(zs)} zeros.`,
      )
    }
    const es = distinctXs('extremum').length
    if (es > caps.extrema) {
      return fail(
        caps.extrema === 1
          ? (ONE_TURN[curve.modelId] ??
             `${Fam} has exactly one turning point, so it cannot have ${word(es)}.`)
          : `${Fam} turns around at most ${times(caps.extrema)}, so it cannot have ${word(es)} maxima and minima.`,
      )
    }
    const is = distinctXs('inflection').length
    if (is > caps.inflections) {
      return fail(
        caps.inflections === 0
          ? `${Fam} never changes concavity, so it has no inflection point to place.`
          : `${Fam} changes concavity at most ${times(caps.inflections)}, so it cannot have ${word(is)} inflection points.`,
      )
    }
  }

  // a cubic's turning points and inflection are one rigid arrangement
  if (curve.modelId === 'poly3') {
    const structural = cubicStructure(all, distinctXs('zero').length)
    if (structural) return fail(structural)
  }

  // ---- capacity ----------------------------------------------------------
  const needed = all.reduce((s, r) => s + reqCost(r), 0)
  if (needed > p0.length) {
    return fail(
      `That asks for ${word(needed)} conditions at once, and ${An} ${name} only has ` +
        `${word(p0.length)} ${p0.length === 1 ? 'number' : 'numbers'} to set. ` +
        'Unpin a feature and try again.',
    )
  }

  // ---- solve -------------------------------------------------------------
  let params: number[] | null = null
  let exact = false
  const degree = POLY_DEGREE[curve.modelId]

  if (kind === 'y-intercept' && pins.length === 0 && spec.translate) {
    // f(0) = b is a pure vertical shift for every family that can translate —
    // and for a polynomial it is exactly "set the constant term"
    params = spec.translate(p0, 0, ty - matched.pos.y)
    exact = true
  } else if (degree !== undefined) {
    const solved = solvePolyFeature(p0, work, degree, feature, pins, before, matched, kind)
    if (typeof solved === 'string') return fail(solved)
    params = solved
    exact = params !== null
  } else if (pins.length === 0) {
    params = closedFormFeature(curve, spec, kind, tx, ty, matched, yGiven)
    exact = params !== null
  }

  if (!params && explicit) {
    params = numericFeatureEdit(spec, p0, work, all, tx)
    exact = false
  }
  if (!params) {
    return fail(
      `Moving the ${label} of ${An} ${name} is not something this family can be solved for — drag its handles instead.`,
    )
  }
  if (!params.every(Number.isFinite)) {
    return fail('That edit produced numbers that are not usable, so the curve is unchanged.')
  }

  // ---- did it actually land? --------------------------------------------
  const after: FittedCurve = { ...curve, params, domain: outDomain }
  const afterPts = analyzeCurve(after, models)
  const posTol = Math.max(1e-6, 1e-5 * span)
  let landed: SpecialPoint | null = null
  let landedD = Infinity
  for (const q of afterPts) {
    if (q.kind !== kind) continue
    const d = closed
      ? Math.hypot(q.pos.x - tx, q.pos.y - ty)
      : Math.abs(q.pos.x - tx)
    if (d < landedD) { landedD = d; landed = q }
  }
  const yTol = Math.max(1e-6, 1e-5 * Math.max(1, Math.abs(ty)))
  const hit =
    landed !== null &&
    landedD <= posTol &&
    (kind === 'zero' || Math.abs(landed.pos.y - ty) <= yTol)
  if (!hit) {
    const where = kind === 'zero' || !feature.useY
      ? `x = ${num(tx)}`
      : `(${num(tx)}, ${num(ty)})`
    // Offer the near miss only when it is genuinely near. A solve that failed
    // by turning the curve inside out is not a curve anybody wants instead, so
    // measure what the whole curve did and keep quiet when it ran away.
    const geom = geometryOf(workCurve, spec)
    const asked = Math.hypot(tx - matched.pos.x, ty - matched.pos.y)
    const limit = 5 * asked + 0.05 * span
    const sane = geom ? worstDisplacement(geom, p0, params, limit) <= limit : false
    const msg = `The ${label} cannot be put at ${where}: ${An} ${name} does not bend that way.`
    return sane
      ? fail(`${msg} The closest it can get is offered instead.`, { params, domain: outDomain })
      : fail(msg)
  }

  const also = movedFeatures(before, afterPts, kind, tx, ty, Math.max(1e-7, 1e-9 * span))
  const result: FeatureEditResult = { ok: true, params, domain: outDomain, exact }
  if (also.length > 0) result.alsoMoved = also
  return result
}

/**
 * The cubic's own geometry, checked before any solving.
 *
 * f = c₃x³ + … is point-symmetric about its inflection, which sits exactly
 * halfway between its maximum and minimum, and the maximum is always the higher
 * of the two. Those are not preferences the solver can trade off — a request
 * that breaks them describes a curve that does not exist. Three zeros likewise
 * fix a cubic up to a scale factor, and a scale factor cannot move a turning
 * point, so the zeros and the turning points cannot both be dictated.
 */
function cubicStructure(reqs: Req[], zeroCount: number): string | null {
  const maxes = reqs.filter(r => r.kind === 'maximum')
  const mins = reqs.filter(r => r.kind === 'minimum')
  const infl = reqs.filter(r => r.kind === 'inflection')

  if (zeroCount >= 3 && (maxes.length || mins.length || infl.length)) {
    return 'Three zeros already fix a cubic completely, up to how tall it is drawn — its maximum, minimum and inflection then land wherever those zeros put them, so they cannot be set as well.'
  }
  if (maxes.length && mins.length) {
    const mx = maxes[0]
    const mn = mins[0]
    if (Math.abs(mx.x - mn.x) <= 1e-9) {
      return 'A cubic\'s maximum and minimum are two different points; they cannot both sit at the same x.'
    }
    if (mx.useY && mn.useY && mx.y <= mn.y) {
      return `A cubic falls from its maximum to its minimum, so the maximum is always the higher of the two — but y = ${num(mx.y)} is not above y = ${num(mn.y)}.`
    }
    if (infl.length) {
      const mid = (mx.x + mn.x) / 2
      if (Math.abs(infl[0].x - mid) > 1e-6 * Math.max(1, Math.abs(mid))) {
        return `A cubic is point-symmetric about its inflection, which always sits exactly halfway between its maximum and minimum. A maximum at x = ${num(mx.x)} and a minimum at x = ${num(mn.x)} put it at x = ${num(mid)}, not x = ${num(infl[0].x)}.`
      }
    }
  }
  return null
}

/**
 * The polynomial solve. Constraints are added in priority order — the feature
 * being moved first, then the user's pins, then the shape conditions — and any
 * that a curve of this degree cannot honour alongside the others is dropped
 * (it shows up in alsoMoved, because that feature then moves).
 *
 * Two shape conditions carry the "moves as little as possible" requirement
 * beyond what the L2 metric alone can say:
 *
 *   * moving a TURNING POINT or an INFLECTION holds the leading coefficient, so
 *     the curve keeps its scale and simply slides — this is what makes "put the
 *     vertex at (2, −1)" on a parabola of width a give exactly a(x−2)² − 1
 *     rather than a re-widened parabola through the same point;
 *   * moving a ZERO holds the curve's OTHER zeros, because zeros are the one
 *     feature a teacher enumerates as a set: setting them to −2, 1 and 3 one at
 *     a time must end with −2, 1 and 3. The leading coefficient is deliberately
 *     left free here, and the L2 metric picks it — with all three zeros of a
 *     cubic fixed, it is the only freedom left, and it lands the curve closest
 *     to the one already on screen.
 *
 * Returns coefficients, a refusal string, or null (caller falls back).
 */
function solvePolyFeature(
  p0: number[],
  dom: [number, number],
  degree: number,
  feature: Req,
  pins: Req[],
  before: SpecialPoint[],
  matched: SpecialPoint,
  kind: SpecialPointKind,
): number[] | string | null {
  const n = Math.min(degree, p0.length - 1)
  const m = (dom[0] + dom[1]) / 2
  const h = (dom[1] - dom[0]) / 2
  if (!(h > 0)) return null
  const cu0 = polyToU(p0, m, h)

  const set = new RowSet()
  // 1. the feature being moved — mandatory
  for (const r of reqRows(feature, n, m, h)) {
    if (set.add(r) === 'contradiction') {
      return `Those conditions contradict each other: the ${kindLabel(feature.kind)} cannot be at x = ${num(feature.x)} and satisfy what is already asked of the curve.`
    }
  }
  // 2. the user's pins
  for (const pin of pins) {
    for (const r of reqRows(pin, n, m, h)) {
      if (set.size >= n + 1) break
      if (set.add(r) === 'contradiction') {
        return `The pinned ${kindLabel(pin.kind)} at x = ${num(pin.x)} cannot hold while the ${kindLabel(feature.kind)} moves to x = ${num(feature.x)} — a curve of this family cannot do both.`
      }
    }
  }
  // 3. shape: hold the leading coefficient when a turning point or inflection
  //    moves, so the curve keeps its own scale
  if (kind === 'maximum' || kind === 'minimum' || kind === 'inflection') {
    if (set.size < n + 1) {
      const row = new Array<number>(n + 1).fill(0)
      row[n] = 1
      set.add({ row, rhs: cu0[n] })
    }
  }
  // 3b. a cubic's inflection is its centre of symmetry, exactly as a parabola's
  //     vertex is: moving it should slide the whole curve rather than reshape
  //     it. Holding the scale is enough to make the parabola's vertex slide,
  //     but a cubic still has the slope AT the inflection free, and leaving it
  //     to the metric shortens the gap between the turning points — the curve
  //     the teacher pointed at is no longer the curve they get back.
  if (kind === 'inflection' && n === 3 && set.size < n + 1) {
    let slope = 0
    for (let k = 1; k < p0.length; k++) {
      slope += k * p0[k] * Math.pow(matched.pos.x, k - 1)
    }
    set.add({ row: derivRow(n, (feature.x - m) / h), rhs: h * slope })
  }
  // 4. auto-pin: a zero move holds the curve's other zeros
  if (kind === 'zero') {
    for (const q of before) {
      if (q.kind !== 'zero') continue
      if (Math.abs(q.pos.x - matched.pos.x) <= 1e-12) continue
      if (Math.abs(q.pos.x - feature.x) <= 1e-12) continue
      if (set.size >= n + 1) break
      set.add({ row: powRow(n, (q.pos.x - m) / h), rhs: 0 })
    }
  }

  const finish = (cu: number[] | null): number[] | null => {
    if (!cu) return null
    const out = polyFromU(cu, m, h)
    while (out.length < p0.length) out.push(0)
    return out.every(Number.isFinite) ? out : null
  }

  let cx = finish(solveConstrained(cu0.slice(0, n + 1), set.rows))
  if (!cx) return null

  // Orientation is part of the shape. Least squares is free to answer a request
  // with an upside-down curve when that happens to sit closer in the mean — a
  // zero dragged from 1 to 14 came back as a cubic pointing DOWN through the
  // same three roots. Turning the drawn curve over is never the small change it
  // scores as, so when the leading coefficient flips sign, hold it instead and
  // let the remaining freedom go elsewhere.
  if (p0[n] !== 0 && cx[n] * p0[n] < 0 && set.size < n + 1) {
    const row = new Array<number>(n + 1).fill(0)
    row[n] = 1
    if (set.add({ row, rhs: cu0[n] }) === 'accepted') {
      cx = finish(solveConstrained(cu0.slice(0, n + 1), set.rows)) ?? cx
    }
  }

  // A polynomial that has collapsed to a lower degree is the signature of an
  // over-determined request — three zeros AND a turning point can only be met
  // by the zero polynomial, which is not a curve.
  let scale = 0
  for (const v of cx) scale = Math.max(scale, Math.abs(v))
  if (!(scale > 0)) {
    return 'Those conditions can only be met by a flat line at y = 0, which is not the curve you drew.'
  }
  return cx
}

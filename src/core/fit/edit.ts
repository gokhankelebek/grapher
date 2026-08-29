// ============================================================================
// Curve editing — "grab the math itself".
//   getHandles       model-aware control points per family
//   applyHandleDrag  exact closed-form updates where possible
//   dragCurvePoint   universal semantic drag (damped Gauss–Newton, soft anchors)
//   oversketch       redraw part of a curve in ink, refit the same family
//   snapParams       magnetize params to nice values
//   nearestOnCurve   closest curve point to p (hit-testing / grab finding)
// Pure TS, no DOM, hot paths kept allocation-light (dragCurvePoint runs per
// pointermove).
// ============================================================================

import type { FittedCurve, ModelSpec, Vec2, CurveHandle } from '../types'
import {
  linearLeastSquares,
  levenbergMarquardt,
  polyfit,
  fitCircle,
  fitConic,
  conicToCenterForm,
  centerFormToConic,
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
  // integer params (rose petal count) must never drift
  if (curve.modelId === 'polarRose') res.params[1] = Math.round(p0[1])
  return res.params
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

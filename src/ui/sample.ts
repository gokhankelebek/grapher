// Best-effort screen-space sampling of a fitted curve, used for canvas hit
// testing (selection) only. Rendering itself is done by render/curves.ts.
import type { FittedCurve, ModelSpec, Vec2, Viewport } from '../core/types'
import { ppuX, toScreen } from '../core/types'

const TWO_PI = Math.PI * 2

/** Sample a curve as a screen-space (css px) polyline. */
export function sampleCurveScreen(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  vp: Viewport,
  n = 220,
): Vec2[] {
  const spec: ModelSpec | undefined = models[curve.modelId]
  const out: Vec2[] = []
  const push = (mp: Vec2): void => {
    if (Number.isFinite(mp.x) && Number.isFinite(mp.y)) out.push(toScreen(mp, vp))
  }

  try {
    if (spec && spec.evalExplicit) {
      const halfW = vp.widthPx / (2 * ppuX(vp))
      const [x0, x1] = curve.domain ?? [vp.center.x - halfW, vp.center.x + halfW]
      for (let i = 0; i <= n; i++) {
        const x = x0 + ((x1 - x0) * i) / n
        push({ x, y: spec.evalExplicit(curve.params, x) })
      }
    } else if (spec && spec.evalPolar) {
      const [t0, t1] = curve.domain ?? [0, TWO_PI]
      for (let i = 0; i <= n; i++) {
        const th = t0 + ((t1 - t0) * i) / n
        const r = spec.evalPolar(curve.params, th)
        push({ x: r * Math.cos(th), y: r * Math.sin(th) })
      }
    } else if (spec && spec.evalParametric) {
      const [t0, t1] = curve.domain ?? [0, TWO_PI]
      for (let i = 0; i <= n; i++) {
        push(spec.evalParametric(curve.params, t0 + ((t1 - t0) * i) / n))
      }
    } else if (curve.sourceStroke) {
      // Implicit models (or unknown model ids): fall back to the source ink.
      for (const p of curve.sourceStroke) push(p)
    }
  } catch {
    // A model eval threw — hit testing is best-effort; return what we have.
  }
  return out
}

/** Minimum distance from p to the polyline pts (screen px). */
export function distToPolyline(p: Vec2, pts: Vec2[]): number {
  let best = Infinity
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const abx = b.x - a.x
    const aby = b.y - a.y
    const segLen2 = abx * abx + aby * aby
    // Skip discontinuities (asymptote jumps) so we don't hit-test across them.
    if (segLen2 > 300 * 300) continue
    let t = segLen2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / segLen2 : 0
    t = Math.max(0, Math.min(1, t))
    const dx = p.x - (a.x + t * abx)
    const dy = p.y - (a.y + t * aby)
    const d = Math.hypot(dx, dy)
    if (d < best) best = d
  }
  return best
}

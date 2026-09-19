// ============================================================================
// src/ui/AnalysisOverlay.tsx — the markers that belong to the OTHER curves.
//
// Analysis used to mean "mark up the selected curve". So a teacher could have
// the toggle lit, click away from a curve, and be looking at an empty board
// with a button that said the markers were on. The toggle now means what it
// says: while it is on, every visible curve shows where it crosses, turns and
// changes concavity.
//
// Labels stay with the SELECTION. Coordinates for four curves at once is a
// wall of text, and the selected curve is the one being talked about — it gets
// its markers, its labels and its handles from renderBoard, exactly as before.
// This layer draws the rest: the same glyph vocabulary, no text, no chrome, and
// no pointer (it is `pointer-events: none`), so nothing about clicking,
// dragging or hit-testing changes.
//
// It is a separate canvas rather than more scene, because the scene's analysis
// field describes ONE curve and renderBoard is not ours to widen.
// ============================================================================

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import type { MutableRefObject } from 'react'
import type { FittedCurve, SpecialPoint, Theme, Viewport } from '../core/types'
import { toScreen } from '../core/types'

const TWO_PI = Math.PI * 2

export interface CurveMarkers {
  curve: FittedCurve
  points: readonly SpecialPoint[]
}

export interface AnalysisOverlayHandle {
  redraw(): void
}

interface Props {
  /** Curves whose markers this layer owns — the visible, UNSELECTED ones. */
  marked: readonly CurveMarkers[]
  theme: Theme
  vpRef: MutableRefObject<Viewport>
}

/** Marker radius by kind, matching renderBoard's own vocabulary. */
function radiusOf(kind: SpecialPoint['kind']): number {
  switch (kind) {
    case 'zero':
      return 4
    case 'inflection':
      return 4.6
    case 'maximum':
    case 'minimum':
      return 3.5
    case 'y-intercept':
      return 2.6
    default:
      return 3
  }
}

/**
 * One curve's markers, without labels.
 *
 * The shapes are renderBoard's: a hollow ring for a zero, a filled dot for a
 * turning point, a diamond for an inflection. A context marker is drawn at
 * 0.7 alpha so the selected curve's own markers still read as the ones being
 * discussed.
 */
export function drawContextMarkers(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  points: readonly SpecialPoint[],
  color: string,
  bg: string,
  alpha = 0.7,
): void {
  if (points.length === 0) return
  ctx.save()
  ctx.globalAlpha = alpha
  for (const p of points) {
    if (!p || !p.pos || !Number.isFinite(p.pos.x) || !Number.isFinite(p.pos.y)) continue
    const s = toScreen(p.pos, vp)
    if (s.x < -30 || s.y < -30 || s.x > vp.widthPx + 30 || s.y > vp.heightPx + 30) continue
    const r = radiusOf(p.kind)
    if (p.kind === 'inflection') {
      ctx.beginPath()
      ctx.moveTo(s.x, s.y - r)
      ctx.lineTo(s.x + r, s.y)
      ctx.lineTo(s.x, s.y + r)
      ctx.lineTo(s.x - r, s.y)
      ctx.closePath()
      ctx.fillStyle = bg
      ctx.fill()
      ctx.lineWidth = 1.7
      ctx.strokeStyle = color
      ctx.stroke()
      continue
    }
    if (p.kind === 'zero') {
      ctx.beginPath()
      ctx.arc(s.x, s.y, r, 0, TWO_PI)
      ctx.fillStyle = bg
      ctx.fill()
      ctx.lineWidth = 1.8
      ctx.strokeStyle = color
      ctx.stroke()
      continue
    }
    ctx.beginPath()
    ctx.arc(s.x, s.y, r, 0, TWO_PI)
    ctx.fillStyle = color
    ctx.fill()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = bg
    ctx.stroke()
  }
  ctx.restore()
}

export const AnalysisOverlay = forwardRef<AnalysisOverlayHandle, Props>(function AnalysisOverlay(
  { marked, theme, vpRef },
  handle,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const markedRef = useRef(marked)
  const themeRef = useRef(theme)
  markedRef.current = marked
  themeRef.current = theme
  const rafRef = useRef(0)

  const draw = useCallback((): void => {
    rafRef.current = 0
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const vp = vpRef.current
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1))
    const w = Math.max(1, Math.round(vp.widthPx * dpr))
    const h = Math.max(1, Math.round(vp.heightPx * dpr))
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    canvas.style.width = `${vp.widthPx}px`
    canvas.style.height = `${vp.heightPx}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, vp.widthPx, vp.heightPx)
    for (const m of markedRef.current) {
      drawContextMarkers(ctx, vp, m.points, m.curve.color, themeRef.current.bg)
    }
  }, [vpRef])

  const schedule = useCallback((): void => {
    if (!rafRef.current) rafRef.current = requestAnimationFrame(draw)
  }, [draw])

  useImperativeHandle(handle, () => ({ redraw: schedule }), [schedule])

  useEffect(() => {
    schedule()
  }, [marked, theme, schedule])

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    },
    [],
  )

  return <canvas ref={canvasRef} className="analysis-overlay" aria-hidden="true" />
})

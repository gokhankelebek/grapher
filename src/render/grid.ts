// ============================================================================
// src/render/grid.ts — Desmos-quality infinite grid + axes + labels.
// All drawing units are CSS pixels (ctx is already DPR-scaled by the caller).
// ============================================================================

import type { Viewport, Theme } from '../core/types'

// ---------------------------------------------------------------------------
// Nice step selection: 1–2–5 × 10^n ladder, major spacing targeting 70–120 px.
// Minor subdivision: mantissa 2 → 4 minors (0.5 steps), otherwise 5.
// ---------------------------------------------------------------------------

export interface GridStep {
  major: number     // math units between major lines
  minorDiv: number  // minors per major (4 or 5)
}

const LADDER: ReadonlyArray<readonly [number, number]> = [
  [1, 5],
  [2, 4],
  [5, 5],
  [10, 5],
]

/**
 * The 1–2–5 ladder, shared by every board kind.
 *
 * Exported because a number line needs exactly this decision and must not make
 * a second one: two ladders would drift, and a figure whose ticks disagree with
 * the grid it was copied from is worse than no ticks at all. `minPx` is the
 * only thing that differs — a number line has no vertical labels competing for
 * room, so it can afford a denser ladder (labelling every unit where the
 * cartesian grid would label every second one).
 */
export function pickTickStep(pxPerUnit: number, minPx = 70): GridStep {
  const raw = (minPx / 70) * 90 / pxPerUnit // math units that span the target gap
  const exp = Math.floor(Math.log10(raw))
  const base = Math.pow(10, exp)
  let major = 10 * base
  let minorDiv = 5
  for (let i = 0; i < LADDER.length; i++) {
    const step = LADDER[i][0] * base
    if (step * pxPerUnit >= minPx) {
      major = step
      minorDiv = LADDER[i][1]
      break
    }
  }
  return { major, minorDiv }
}

// ---------------------------------------------------------------------------
// Tick label formatting: clean decimals via toPrecision trimming; exponent
// form for |v| >= 1e6 or |v| <= 1e-4.
// ---------------------------------------------------------------------------

function trimZeros(s: string): string {
  if (s.indexOf('e') >= 0 || s.indexOf('.') < 0) return s
  let out = s.replace(/0+$/, '')
  if (out.endsWith('.')) out = out.slice(0, -1)
  return out
}

export function formatTick(v: number): string {
  if (v === 0 || !Number.isFinite(v)) return '0'
  const a = Math.abs(v)
  if (a >= 1e6 || a <= 1e-4) {
    const exp = Math.floor(Math.log10(a) + 1e-12)
    const mant = v / Math.pow(10, exp)
    return `${trimZeros(mant.toPrecision(6))}e${exp}`
  }
  return trimZeros(v.toPrecision(12))
}

// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

const LABEL_FONT = '11px system-ui, -apple-system, "Segoe UI", sans-serif'
const ARROW_LEN = 8
const ARROW_HALF = 3.5

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  theme: Theme,
): void {
  const W = vp.widthPx
  const H = vp.heightPx
  const ppu = vp.pxPerUnit
  if (W <= 0 || H <= 0 || !(ppu > 0)) {
    ctx.fillStyle = theme.bg
    ctx.fillRect(0, 0, Math.max(0, W), Math.max(0, H))
    return
  }

  ctx.save()
  ctx.fillStyle = theme.bg
  ctx.fillRect(0, 0, W, H)

  const { major, minorDiv } = pickTickStep(ppu)
  const minor = major / minorDiv

  // visible math range
  const xMin = vp.center.x - W / 2 / ppu
  const xMax = vp.center.x + W / 2 / ppu
  const yMin = vp.center.y - H / 2 / ppu
  const yMax = vp.center.y + H / 2 / ppu

  const sx = (x: number): number => W / 2 + (x - vp.center.x) * ppu
  const sy = (y: number): number => H / 2 - (y - vp.center.y) * ppu

  // ---- minor gridlines (skip indices that land on majors) -----------------
  ctx.lineWidth = 1
  ctx.strokeStyle = theme.gridMinor
  ctx.beginPath()
  {
    const k0 = Math.ceil(xMin / minor)
    const k1 = Math.floor(xMax / minor)
    for (let k = k0; k <= k1; k++) {
      if (((k % minorDiv) + minorDiv) % minorDiv === 0) continue
      const px = sx(k * minor)
      ctx.moveTo(px, 0)
      ctx.lineTo(px, H)
    }
    const j0 = Math.ceil(yMin / minor)
    const j1 = Math.floor(yMax / minor)
    for (let j = j0; j <= j1; j++) {
      if (((j % minorDiv) + minorDiv) % minorDiv === 0) continue
      const py = sy(j * minor)
      ctx.moveTo(0, py)
      ctx.lineTo(W, py)
    }
  }
  ctx.stroke()

  // ---- major gridlines (skip the axes; those get axis styling) ------------
  ctx.strokeStyle = theme.gridMajor
  ctx.beginPath()
  {
    const k0 = Math.ceil(xMin / major)
    const k1 = Math.floor(xMax / major)
    for (let k = k0; k <= k1; k++) {
      if (k === 0) continue
      const px = sx(k * major)
      ctx.moveTo(px, 0)
      ctx.lineTo(px, H)
    }
    const j0 = Math.ceil(yMin / major)
    const j1 = Math.floor(yMax / major)
    for (let j = j0; j <= j1; j++) {
      if (j === 0) continue
      const py = sy(j * major)
      ctx.moveTo(0, py)
      ctx.lineTo(W, py)
    }
  }
  ctx.stroke()

  // ---- axes with arrowheads ----------------------------------------------
  const axisX = sx(0) // screen x of the y-axis
  const axisY = sy(0) // screen y of the x-axis
  const yAxisVisible = axisX >= 0 && axisX <= W
  const xAxisVisible = axisY >= 0 && axisY <= H

  ctx.strokeStyle = theme.axis
  ctx.fillStyle = theme.axis
  ctx.lineWidth = 1.5
  if (yAxisVisible) {
    ctx.beginPath()
    ctx.moveTo(axisX, H)
    ctx.lineTo(axisX, 0)
    ctx.stroke()
    // arrowheads: up (top edge) and down (bottom edge)
    ctx.beginPath()
    ctx.moveTo(axisX, 0)
    ctx.lineTo(axisX - ARROW_HALF, ARROW_LEN)
    ctx.lineTo(axisX + ARROW_HALF, ARROW_LEN)
    ctx.closePath()
    ctx.moveTo(axisX, H)
    ctx.lineTo(axisX - ARROW_HALF, H - ARROW_LEN)
    ctx.lineTo(axisX + ARROW_HALF, H - ARROW_LEN)
    ctx.closePath()
    ctx.fill()
  }
  if (xAxisVisible) {
    ctx.beginPath()
    ctx.moveTo(0, axisY)
    ctx.lineTo(W, axisY)
    ctx.stroke()
    // arrowheads: right and left edges
    ctx.beginPath()
    ctx.moveTo(W, axisY)
    ctx.lineTo(W - ARROW_LEN, axisY - ARROW_HALF)
    ctx.lineTo(W - ARROW_LEN, axisY + ARROW_HALF)
    ctx.closePath()
    ctx.moveTo(0, axisY)
    ctx.lineTo(ARROW_LEN, axisY - ARROW_HALF)
    ctx.lineTo(ARROW_LEN, axisY + ARROW_HALF)
    ctx.closePath()
    ctx.fill()
  }

  // ---- axis number labels -------------------------------------------------
  ctx.font = LABEL_FONT
  ctx.fillStyle = theme.label

  // x labels: just below the x-axis, clamped to top/bottom edges when the
  // axis is off-screen (labels slide along the edge, Desmos-style).
  {
    const labelY = clamp(axisY + 5, 4, H - 17)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const k0 = Math.ceil(xMin / major)
    const k1 = Math.floor(xMax / major)
    for (let k = k0; k <= k1; k++) {
      if (k === 0) continue
      const px = sx(k * major)
      if (px < 14 || px > W - 14) continue // avoid arrowhead corners
      ctx.fillText(formatTick(k * major), px, labelY)
    }
  }

  // y labels: just left of the y-axis, clamped to left/right edges.
  {
    ctx.textBaseline = 'middle'
    const j0 = Math.ceil(yMin / major)
    const j1 = Math.floor(yMax / major)
    for (let j = j0; j <= j1; j++) {
      if (j === 0) continue
      const py = sy(j * major)
      if (py < 12 || py > H - 12) continue
      const text = formatTick(j * major)
      const tw = ctx.measureText(text).width
      // right-aligned against the axis, but never pushed off either edge
      const lx = clamp(axisX - 6, tw + 4, W - 4)
      ctx.textAlign = 'right'
      ctx.fillText(text, lx, py)
    }
  }

  // single "0" near the origin (only when the origin itself is on screen)
  if (axisX >= 0 && axisX <= W && axisY >= 0 && axisY <= H) {
    ctx.textAlign = 'right'
    ctx.textBaseline = 'top'
    ctx.fillText('0', axisX - 5, axisY + 5)
  }

  ctx.restore()
}

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

/**
 * Base type size for the axis tick labels, multiplied by `opts.type`.
 * Nothing on this canvas renders above ~13.65px at 1:1; projected at 1280x720
 * across a classroom, 11px is not readable from the back row, so every font
 * here is a base size times a presentation scale rather than a literal.
 */
const LABEL_PX = 11

const gridFont = (px: number): string =>
  `${px}px system-ui, -apple-system, "Segoe UI", sans-serif`

const ARROW_LEN = 8
const ARROW_HALF = 3.5

/**
 * Line weight is a LADDER, exactly like the grid colours in types.ts:
 * minor 1, major 1.25, axis 1.5. Colour alone does not survive a projector's
 * ambient wash, so the three levels of the grid differ in THICKNESS as well as
 * in value -- and the axis is separated from its own labels, which are drawn in
 * theme.label (a step above theme.axis), never in the axis colour.
 */
export const GRID_MINOR_WIDTH = 1
export const GRID_MAJOR_WIDTH = 1.25
export const GRID_AXIS_WIDTH = 1.5

/**
 * Presentation scaling (see BoardScene.present): `type` multiplies every font,
 * `stroke` every line weight. Both default to 1, so an unscaled board draws
 * exactly the pixels it drew before this existed.
 */
export interface PaintScale {
  type?: number
  stroke?: number
}

/** Normalise a PaintScale: finite, positive, and within sane projector limits. */
export function paintScale(o?: PaintScale | null): { type: number; stroke: number } {
  const n = (v: number | undefined): number =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(6, Math.max(0.5, v)) : 1
  return { type: n(o?.type), stroke: n(o?.stroke) }
}

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  theme: Theme,
  opts?: PaintScale | null,
): void {
  const { type, stroke } = paintScale(opts)
  const fpx = LABEL_PX * type
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
  ctx.lineWidth = GRID_MINOR_WIDTH * stroke
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
  // A full step heavier than the minors: the ladder is weight + colour, so it
  // still reads when a projector has eaten the colour difference.
  ctx.lineWidth = GRID_MAJOR_WIDTH * stroke
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

  // The axis LINE is theme.axis; its number labels below are theme.label, a
  // step above it. Structure and annotation must never be the same value.
  ctx.strokeStyle = theme.axis
  ctx.fillStyle = theme.axis
  ctx.lineWidth = GRID_AXIS_WIDTH * stroke
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
  ctx.font = gridFont(fpx)
  ctx.fillStyle = theme.label

  // x labels: just below the x-axis, clamped to top/bottom edges when the
  // axis is off-screen (labels slide along the edge, Desmos-style).
  {
    const labelY = clamp(axisY + 5 * type, 4, H - fpx - 6)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const k0 = Math.ceil(xMin / major)
    const k1 = Math.floor(xMax / major)
    for (let k = k0; k <= k1; k++) {
      if (k === 0) continue
      const px = sx(k * major)
      const edge = Math.max(14, fpx + 3)
      if (px < edge || px > W - edge) continue // avoid arrowhead corners
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
      if (py < fpx + 1 || py > H - fpx - 1) continue
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
    ctx.fillText('0', axisX - 5 * type, axisY + 5 * type)
  }

  ctx.restore()
}

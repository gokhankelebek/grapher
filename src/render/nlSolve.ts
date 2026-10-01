// ============================================================================
// src/render/nlSolve.ts — a SOLVED inequality on the number line.
//
//      A    ──── + ──── 0 ──── − ──── 0 ──── + ────           sign row
//           ◀━━━━━━━━━○                ○━━━━━━━━━▶           clause A
//      B    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━○              clause B
//      A ∩ B
//   ◀───────━━━━━━━━━○────┼────┼────┼────○━━━━━○──────▶       the board's axis
//                  −2              ...  2     3
//                  −√2                          (exact labels, second row)
//
// What it draws for each LINE of a solve figure (src/ui/nlSolve.ts decides
// the lines and where they sit; this module only paints):
//
//   the set       a thick bar over each solution interval, an arrowhead where
//                 it runs to ±∞, ● / ○ at every critical value — a hollow
//                 dot is an OPAQUE ground-coloured disc, the rule
//                 render/numberline.ts exists for
//   tests         a small tick at each test point, "t = 0" above it
//   signs         + / − in each interval, 0 or "und" at the critical values
//   distance      |x − a| R b: a bracket of radius b either side of the
//                 centre, the centre marked down to the line, and the
//                 sentence "within 3/2 of 5/2" over it
//   name          "A", "B" in a gutter at the left of a stacked line,
//                 "A ∩ B" above-left of the combined one
//
// and, under the board's own axis, the critical values' EXACT forms (−√2,
// π/6) in a second row below the integer tick labels.
//
// FIGURE, not chrome: it reaches every export; under a mono style (SAT / AP)
// every stroke and letter is the one ink. All units CSS px.
// ============================================================================

import type { Theme, Viewport } from '../core/types'
import type { RealSet } from '../core/domainRange'
import { labelFont, paintScale, type PaintScale } from './grid'
import { nlDotRadius, nlTickStep, nlToScreenX, NL_BAR_WIDTH, NL_MAX_BAR_WIDTH, NL_MIN_BAR_WIDTH } from './numberline'

// ---------------------------------------------------------------------------
// The contract with src/ui/nlSolve.ts
// ---------------------------------------------------------------------------

export interface SolveDistanceSpec {
  center: number
  radius: number
  centerText: string
  radiusText: string
  /** "within 3/2 of 5/2" */
  label: string
}

export interface SolveLineSpec {
  /** "" | "A" | "B" | "A ∩ B" */
  label: string
  /** drawn on the board's own axis (true for exactly one line of the first figure) */
  main: boolean
  set: RealSet
  /** ● (closed) / ○ at each critical value and set end */
  dots: { x: number; closed: boolean }[]
  signs: {
    marks: { x: number; label: '0' | 'und' | '' }[]
    intervals: { from: number; to: number; sign: 1 | -1 | 0 | null }[]
  } | null
  tests: { x: number; text: string }[] | null
  distance: SolveDistanceSpec | null
}

export interface SolveFigureSpec {
  id: string
  color: string
  /** top line first; the last is the combined set */
  lines: SolveLineSpec[]
  /** exact labels under the board's axis */
  exact: { x: number; text: string }[]
  /** x's of the dashed guides through a stacked figure (empty: one line) */
  guides: number[]
}

export interface SolveLineLayout {
  y: number
  testsY: number | null
  signsY: number | null
  bracketY: number | null
  top: number
}

export interface SolveLayout {
  lines: SolveLineLayout[]
  top: number
}

/** Band heights above a line, px before `present.type`. */
export const SOLVE_BAND = {
  /** dot clearance between the line and its first band */
  clear: 12,
  tests: 16,
  signs: 24,
  distance: 42,
  /** the bracket's stroke sits this far above the distance band's bottom */
  bracketDrop: 13,
  /** its end ticks drop this far toward the line */
  bracketTick: 7,
  /** its label sits this far above it */
  bracketLabel: 15,
  /** between one line's top band and the next line up */
  gap: 24,
  /** a bare stacked line still leaves room for its name above-left */
  label: 20,
} as const

/** The bracket of |x − a| R b, in px. */
export interface BracketGeometry {
  x0: number
  xc: number
  x1: number
  y: number
  tickY: number
  labelX: number
  labelY: number
  halves: { x: number; y: number }[] | null
}

/**
 * Geometry of the distance bracket: [a − b, a + b] at height `bracketY`, end
 * ticks dropping toward the line, the label centred over the centre, and the
 * radius written over each half when a half is wide enough to hold it.
 */
export function distanceBracket(
  d: { center: number; radius: number },
  vp: Viewport,
  bracketY: number,
  type = 1,
  halfLabelPx = 0,
): BracketGeometry {
  const xc = nlToScreenX(d.center, vp)
  const x0 = nlToScreenX(d.center - d.radius, vp)
  const x1 = nlToScreenX(d.center + d.radius, vp)
  const tickY = bracketY + SOLVE_BAND.bracketTick * type
  const halfW = (x1 - x0) / 2
  const halves =
    halfW >= halfLabelPx + 10 * type
      ? [
          // ON the line, its plate breaking it like a dimension line: just
          // above it, the radius ran into the plate of the label over the
          // centre and lost its top half.
          { x: (x0 + xc) / 2, y: bracketY },
          { x: (xc + x1) / 2, y: bracketY },
        ]
      : null
  return { x0, xc, x1, y: bracketY, tickY, labelX: xc, labelY: bracketY - SOLVE_BAND.bracketLabel * type, halves }
}

// ---------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------

export interface SolvePaintOpts {
  vp: Viewport
  theme: Theme
  /** the set's colour, already print-mapped / mono-inked by the caller */
  color: string
  /** letters and rules: the board's text colour, or the one ink under mono */
  text: string
  scale?: PaintScale | null
  font?: 'sans' | 'serif' | null
  barWidth?: number
  dash?: number[]
  opacity?: number
  /** chrome: a soft wash saying "this one is selected" */
  selected?: boolean
}

const TWO_PI = Math.PI * 2
const BAR_ARROW_LEN = 11
const GUIDE_DASH = [4, 5]

function arrowHead(ctx: CanvasRenderingContext2D, x: number, y: number, dir: -1 | 1, len: number, half: number): void {
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x - dir * len, y - half)
  ctx.lineTo(x - dir * len, y + half)
  ctx.closePath()
  ctx.fill()
}

/** A label on a ground-coloured plate, centred at (x, y). */
function plateText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  bg: string,
  pad = 3,
): number {
  const w = ctx.measureText(text).width
  const h = parseFloat(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? '12')
  ctx.fillStyle = bg
  ctx.fillRect(x - w / 2 - pad, y - h / 2 - 1, w + 2 * pad, h + 2)
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x, y)
  return w
}

/** Where a +/− goes in an interval: its visible middle, or nothing if too narrow. */
function visibleMid(a: number, b: number, left: number, right: number, minW: number): number | null {
  const lo = Math.max(a, left)
  const hi = Math.min(b, right)
  if (!(hi - lo >= minW)) return null
  return (lo + hi) / 2
}

/**
 * Paint one solve figure laid out by `layout`. The order is fixed: guides,
 * then per line its rule, bands and set (bars before dots, so an open dot's
 * ground-coloured centre covers the bar), then the exact labels.
 */
export function drawSolveFigure(
  ctx: CanvasRenderingContext2D,
  spec: SolveFigureSpec,
  layout: SolveLayout,
  o: SolvePaintOpts,
): void {
  const { vp, theme } = o
  const W = vp.widthPx
  if (!(W > 0) || layout.lines.length !== spec.lines.length) return
  const { type, stroke } = paintScale(o.scale)
  const font = o.font ?? null
  const fontPx = (px: number, italic = false): string => labelFont(font ? { font } : null, px * type, italic)
  const w = Math.max(NL_MIN_BAR_WIDTH, Math.min(NL_MAX_BAR_WIDTH, o.barWidth ?? NL_BAR_WIDTH)) * stroke
  const r = nlDotRadius(w)
  const alpha = o.opacity === undefined ? 1 : Math.max(0.05, Math.min(1, o.opacity))
  const sx = (x: number): number => (x === Infinity ? W + 50 : x === -Infinity ? -50 : nlToScreenX(x, vp))
  const bottomY = layout.lines[layout.lines.length - 1].y

  ctx.save()

  if (o.selected) {
    ctx.globalAlpha = 0.1
    ctx.fillStyle = o.color
    const top = layout.top - 4
    ctx.fillRect(0, top, W, bottomY + r + 6 - top)
    ctx.globalAlpha = 1
  }

  // ---- guides: each critical x, dashed through every line of a stack ------
  if (spec.guides.length > 0 && layout.lines.length > 1) {
    const topY = layout.lines[0].y
    ctx.strokeStyle = o.text
    ctx.globalAlpha = 0.35
    ctx.lineWidth = 1 * stroke
    ctx.setLineDash(GUIDE_DASH)
    ctx.beginPath()
    for (const gx of spec.guides) {
      const px = sx(gx)
      if (px < 0 || px > W) continue
      ctx.moveTo(px, topY)
      ctx.lineTo(px, bottomY)
    }
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1
  }

  // ---- exact labels under the board's axis ----------------------------------
  const mainIdx = spec.lines.findIndex((l) => l.main)
  if (mainIdx >= 0 && spec.exact.length > 0) {
    const y = layout.lines[mainIdx].y
    const { major } = nlTickStep(vp, type)
    const rowY = [y + 7 * stroke + 3 * type + 22 * type, y + 7 * stroke + 3 * type + 38 * type]
    ctx.font = fontPx(12)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const rights = [-Infinity, -Infinity]
    for (const e of spec.exact) {
      const px = sx(e.x)
      if (px < 6 || px > W - 6) continue
      // a critical value ON a labelled tick whose label already says it
      const k = e.x / major
      const onTick = Math.abs(k - Math.round(k)) < 1e-9
      const plain = /^−?\d+$/.test(e.text)
      ctx.strokeStyle = o.color
      ctx.lineWidth = 1.6 * stroke
      ctx.beginPath()
      ctx.moveTo(px, y - 7 * stroke)
      ctx.lineTo(px, y + 7 * stroke)
      ctx.stroke()
      if (onTick && plain) continue
      const tw = ctx.measureText(e.text).width
      const row = px - tw / 2 >= rights[0] + 6 ? 0 : px - tw / 2 >= rights[1] + 6 ? 1 : -1
      if (row < 0) continue
      ctx.fillStyle = o.text
      ctx.fillText(e.text, px, rowY[row])
      rights[row] = px + tw / 2
    }
  }

  spec.lines.forEach((line, i) => {
    const L = layout.lines[i]
    const y = L.y
    let left = 0

    // ---- the line's name ---------------------------------------------------
    if (line.label !== '') {
      ctx.font = fontPx(13)
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'left'
      ctx.fillStyle = o.text
      if (line.main) {
        ctx.fillText(line.label, 8, y - 15 * type)
      } else {
        const tw = ctx.measureText(line.label).width
        ctx.fillText(line.label, 8, y)
        left = 8 + tw + 10 * type
      }
    }

    // ---- a stacked line's own rule (the main line IS the board's axis) -----
    if (!line.main) {
      ctx.strokeStyle = theme.axis
      ctx.fillStyle = theme.axis
      ctx.globalAlpha = 0.8
      ctx.lineWidth = 1.2 * stroke
      ctx.beginPath()
      ctx.moveTo(left, y)
      ctx.lineTo(W, y)
      ctx.stroke()
      arrowHead(ctx, W, y, 1, 7 * stroke, 3.2 * stroke)
      arrowHead(ctx, left, y, -1, 7 * stroke, 3.2 * stroke)
      // the board's major ticks, unlabelled, so the stack reads as one scale
      const { major } = nlTickStep(vp, type)
      const xMin = vp.center.x - W / 2 / vp.pxPerUnit
      const xMax = vp.center.x + W / 2 / vp.pxPerUnit
      ctx.beginPath()
      for (let j = Math.ceil(xMin / major); j <= Math.floor(xMax / major); j++) {
        const px = nlToScreenX(j * major, vp)
        if (px < left + 4) continue
        ctx.moveTo(px, y - 4 * stroke)
        ctx.lineTo(px, y + 4 * stroke)
      }
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    // ---- test points ---------------------------------------------------------
    if (line.tests && L.testsY !== null) {
      ctx.strokeStyle = o.text
      ctx.lineWidth = 1.4 * stroke
      ctx.font = fontPx(10, true)
      ctx.fillStyle = o.text
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      let lastRight = -Infinity
      for (const t of line.tests) {
        const px = sx(t.x)
        if (px < left || px > W) continue
        ctx.beginPath()
        ctx.moveTo(px, y - 5 * stroke)
        ctx.lineTo(px, y + 5 * stroke)
        ctx.stroke()
        const tw = ctx.measureText(t.text).width
        if (px - tw / 2 < lastRight + 4) continue
        ctx.fillText(t.text, px, L.testsY)
        lastRight = px + tw / 2
      }
    }

    // ---- the distance bracket (before the signs: their plates cover its
    // centre marker where the two cross) -----------------------------------
    if (line.distance && L.bracketY !== null) {
      const d = line.distance
      ctx.font = fontPx(11)
      const halfLabel = ctx.measureText(d.radiusText).width
      const g = distanceBracket(d, vp, L.bracketY, type, halfLabel)
      ctx.strokeStyle = o.color
      ctx.fillStyle = o.color
      ctx.lineWidth = 1.6 * stroke
      ctx.beginPath()
      ctx.moveTo(g.x0, g.tickY)
      ctx.lineTo(g.x0, g.y)
      ctx.lineTo(g.x1, g.y)
      ctx.lineTo(g.x1, g.tickY)
      ctx.moveTo(g.xc, g.y - 4 * type)
      ctx.lineTo(g.xc, g.tickY)
      ctx.stroke()
      // the centre, marked down to the line
      ctx.setLineDash([3, 3])
      ctx.lineWidth = 1 * stroke
      ctx.beginPath()
      ctx.moveTo(g.xc, g.tickY)
      ctx.lineTo(g.xc, y - r - 2)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(g.xc, y - r - 1)
      ctx.lineTo(g.xc - 4 * type, y - r - 7 * type)
      ctx.lineTo(g.xc + 4 * type, y - r - 7 * type)
      ctx.closePath()
      ctx.fill()
      if (g.halves) {
        ctx.font = fontPx(11, true)
        for (const h of g.halves) plateText(ctx, d.radiusText, h.x, h.y, o.text, theme.bg, 2)
      }
      ctx.font = fontPx(12)
      plateText(ctx, d.label, Math.max(60, Math.min(W - 60, g.labelX)), g.labelY, o.text, theme.bg, 4)
    }

    // ---- the sign row --------------------------------------------------------
    if (line.signs && L.signsY !== null) {
      const sy = L.signsY
      ctx.strokeStyle = o.text
      ctx.globalAlpha = 0.45
      ctx.lineWidth = 1 * stroke
      ctx.beginPath()
      ctx.moveTo(left, sy)
      ctx.lineTo(W, sy)
      ctx.stroke()
      ctx.globalAlpha = 1
      ctx.font = fontPx(15)
      for (const iv of line.signs.intervals) {
        if (iv.sign === null || iv.sign === 0) continue
        const mid = visibleMid(sx(iv.from), sx(iv.to), left, W, 14 * type)
        if (mid === null) continue
        plateText(ctx, iv.sign === 1 ? '+' : '−', mid, sy, o.text, theme.bg, 4)
      }
      ctx.font = fontPx(11)
      for (const m of line.signs.marks) {
        const px = sx(m.x)
        if (px < left || px > W) continue
        ctx.strokeStyle = o.text
        ctx.lineWidth = 1.2 * stroke
        ctx.beginPath()
        ctx.moveTo(px, sy - 7 * type)
        ctx.lineTo(px, sy + 7 * type)
        ctx.stroke()
        if (m.label !== '') plateText(ctx, m.label, px, sy, o.text, theme.bg, 2)
      }
    }

    // ---- the set: bars, arrows, then dots ------------------------------------
    ctx.globalAlpha = alpha
    ctx.strokeStyle = o.color
    ctx.fillStyle = o.color
    ctx.lineWidth = w
    ctx.lineCap = 'butt'
    if (line.set.kind === 'intervals') {
      for (const p of line.set.parts) {
        const loInf = !Number.isFinite(p.lo)
        const hiInf = !Number.isFinite(p.hi)
        const a = loInf ? left + 4 : Math.max(left, sx(p.lo))
        const b = hiInf ? W - 4 : Math.min(W, sx(p.hi))
        if (b < left || a > W) continue
        const barL = loInf ? a + BAR_ARROW_LEN - 1 : a
        const barR = hiInf ? b - BAR_ARROW_LEN + 1 : b
        if (o.dash && o.dash.length > 0) ctx.setLineDash(o.dash)
        if (barR > barL) {
          ctx.beginPath()
          ctx.moveTo(barL, y)
          ctx.lineTo(barR, y)
          ctx.stroke()
        }
        ctx.setLineDash([])
        if (loInf) arrowHead(ctx, a, y, -1, BAR_ARROW_LEN, w * 0.9 + 2)
        if (hiInf) arrowHead(ctx, b, y, 1, BAR_ARROW_LEN, w * 0.9 + 2)
      }
    }
    ctx.globalAlpha = 1
    for (const d of line.dots) {
      const px = sx(d.x)
      if (px < left - r || px > W + r) continue
      ctx.beginPath()
      ctx.arc(px, y, r, 0, TWO_PI)
      if (d.closed) {
        ctx.globalAlpha = alpha
        ctx.fillStyle = o.color
        ctx.fill()
        ctx.lineWidth = 1.2
        ctx.strokeStyle = theme.bg
        ctx.stroke()
      } else {
        ctx.globalAlpha = 1
        ctx.fillStyle = theme.bg
        ctx.fill()
        ctx.globalAlpha = alpha
        ctx.lineWidth = Math.max(2, w * 0.42)
        ctx.strokeStyle = o.color
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }
  })

  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.restore()
}

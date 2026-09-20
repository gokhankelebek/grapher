// ============================================================================
// src/ui/exportFit.ts — "frame the figure, not the window".
//
// An export used to be a photograph of whatever the browser window happened to
// be showing. Measured on a number line: a 2206x1826 PNG whose entire content
// was a 40px strip through the middle — about 90% whitespace, and a teacher
// cropping it by hand before it could go in a worksheet.
//
// So export gets its own VIEWPORT, computed from the content rather than from
// the window: the union of every visible curve's extent and every item's range,
// centred, scaled to fill the frame with a quiet margin, in an aspect the
// teacher can state so a row of figures matches.
//
// This module is pure. It owns no DOM and no storage; renderBoard.ts (which it
// must not modify) still does the drawing, and it is handed the viewport this
// file computes instead of the live one.
// ============================================================================

import type { BoardKind, FittedCurve, ModelSpec, NLItem, Viewport } from '../core/types'
import type { ExportSettings } from './renderBoard'
import { clampExportSettings } from './renderBoard'
import type { Box } from './curveState'
import { curveBounds, unionBoxes } from './curveState'
import { NL_LANE_H, nlLanes } from '../render/numberline'

/** Aspect presets. 'auto' keeps the shape of the board on screen. */
export const ASPECTS = ['auto', 'square', '4:3', 'wide', 'strip'] as const
export type AspectKey = (typeof ASPECTS)[number]

export const ASPECT_LABELS: Record<AspectKey, string> = {
  auto: 'As on screen',
  square: 'Square',
  '4:3': '4:3',
  wide: 'Wide',
  strip: 'Strip',
}

/** width / height for each preset; 'auto' is answered by the caller's viewport. */
const RATIOS: Record<Exclude<AspectKey, 'auto'>, number> = {
  square: 1,
  '4:3': 4 / 3,
  wide: 16 / 9,
  strip: 5,
}

/**
 * A number line's own height, when the shape asked for is Strip.
 *
 * A fixed ratio cannot be right here: the line is drawn at the middle of the
 * canvas with its items stacked ABOVE it, so the height a figure needs is set
 * by how many lanes it uses, not by how wide the paper is. At 5:1 a one-lane
 * answer measured 56px of ink in a 528px image — better than the 1826px it
 * started at, but still mostly air. This measures the stack instead.
 *
 * `2 *` because the renderer centres the axis: the height has to cover the
 * tallest side twice over, or the lanes climb out of the top of the frame.
 */
export const NL_STRIP_PAD = 26
export const MIN_NL_STRIP_H = 96

export function numberLineStripHeight(lanes: number, widthPx: number): number {
  const need = 2 * (Math.max(0, lanes - 1) * NL_LANE_H + NL_STRIP_PAD + NL_LANE_H)
  return Math.round(Math.min(Math.max(MIN_NL_STRIP_H, need), Math.max(1, widthPx / 3)))
}

/**
 * Export settings plus the two things this module adds.
 *
 * It EXTENDS ExportSettings rather than replacing it, so everything in
 * renderBoard.ts — exportGeometry, renderBoardToCanvas, clampExportSettings —
 * keeps taking it unchanged.
 */
export interface FitExportSettings extends ExportSettings {
  /** Frame the content instead of the window. */
  fit: boolean
  /** Shape of the framed plot. Letterboxes whatever doesn't fill it. */
  aspect: AspectKey
}

/**
 * What a document of this kind starts with.
 *
 * A number line is a one-dimensional figure on a two-dimensional board, so the
 * window is nearly all empty by construction and fitting is the only sensible
 * default. A graph's window is usually the framing the teacher chose by panning
 * and zooming, and silently re-framing it would take that choice away.
 */
export function defaultFit(kind: BoardKind): { fit: boolean; aspect: AspectKey } {
  return kind === 'number-line'
    ? { fit: true, aspect: 'strip' }
    : { fit: false, aspect: 'auto' }
}

export const isAspect = (v: unknown): v is AspectKey =>
  typeof v === 'string' && (ASPECTS as readonly string[]).includes(v)

/** clampExportSettings, without dropping the two fields it doesn't know about. */
export function clampFitSettings(s: FitExportSettings): FitExportSettings {
  return {
    ...clampExportSettings(s),
    fit: s.fit === true,
    aspect: isAspect(s.aspect) ? s.aspect : 'auto',
  }
}

/** Fraction of the frame left as quiet space around the figure, per side. */
export const FIT_PAD = 0.06

const MIN_PPU = 0.001
const MAX_PPU = 100000
const clampPpu = (v: number): number =>
  Number.isFinite(v) && v > 0 ? Math.min(MAX_PPU, Math.max(MIN_PPU, v)) : 60

/** width / height the preset asks for, in the caller's terms. */
export function aspectRatio(aspect: AspectKey, vp: Viewport): number {
  if (aspect === 'auto') {
    const r = vp.widthPx / Math.max(1, vp.heightPx)
    return Number.isFinite(r) && r > 0 ? r : 4 / 3
  }
  return RATIOS[aspect]
}

/**
 * The box every visible thing on the board lives in, in math coords.
 *
 * `window` is the x-span to measure a domain-less curve over — the same
 * fallback "Fit to curves" uses, so the export frames what the button frames.
 * Null when there is nothing measurable, and the caller falls back to the live
 * viewport rather than inventing a frame.
 */
export function contentBounds(input: {
  kind: BoardKind
  curves: readonly FittedCurve[]
  items: readonly NLItem[]
  models: Record<string, ModelSpec>
  window: [number, number]
}): Box | null {
  if (input.kind === 'number-line') {
    const xs: number[] = []
    for (const it of input.items) {
      if (it.kind === 'point') {
        if (Number.isFinite(it.x)) xs.push(it.x)
      } else {
        if (it.lo !== null && Number.isFinite(it.lo)) xs.push(it.lo)
        if (it.hi !== null && Number.isFinite(it.hi)) xs.push(it.hi)
      }
    }
    if (xs.length === 0) return null
    return {
      min: { x: Math.min(...xs), y: -0.5 },
      max: { x: Math.max(...xs), y: 0.5 },
    }
  }
  return unionBoxes(
    input.curves
      .filter((c) => c.visible)
      .map((c) => curveBounds(c, input.models[c.modelId], input.window)),
  )
}

/**
 * The viewport that frames `box` at the requested aspect.
 *
 * The plot keeps the on-screen WIDTH and takes its height from the aspect, so
 * "2x" still means roughly what it meant before the option existed and the
 * remembered output size doesn't jump when fitting is switched on.
 *
 * A number line is scaled by width alone. Letting its (nominal, ±0.5) height
 * take part would shrink the line to nothing inside a tall frame — which is
 * the 40px strip this whole option exists to stop producing.
 */
export function fitViewport(
  vp: Viewport,
  box: Box,
  kind: BoardKind,
  aspect: AspectKey,
  /** Lanes the number line's items occupy. Ignored for a graph. */
  lanes = 1,
): Viewport {
  const ratio = aspectRatio(aspect, vp)
  const widthPx = Math.max(1, Math.round(vp.widthPx))
  const heightPx =
    kind === 'number-line' && aspect === 'strip'
      ? numberLineStripHeight(lanes, widthPx)
      : Math.max(1, Math.round(widthPx / ratio))

  const w = Math.max(box.max.x - box.min.x, 1e-6)
  const h = Math.max(box.max.y - box.min.y, 1e-6)
  const usableW = widthPx * (1 - 2 * FIT_PAD)
  const usableH = heightPx * (1 - 2 * FIT_PAD)

  const ppu = clampPpu(
    kind === 'number-line' ? usableW / w : Math.min(usableW / w, usableH / h),
  )

  return {
    center: {
      x: (box.min.x + box.max.x) / 2,
      // The line is drawn at the middle of the canvas by construction; a
      // number-line board's saved y is always 0 and must stay 0.
      y: kind === 'number-line' ? 0 : (box.min.y + box.max.y) / 2,
    },
    pxPerUnit: ppu,
    widthPx,
    heightPx,
  }
}

/**
 * The viewport an export should be drawn with: the fitted one when fitting is
 * on and there is something to fit, otherwise a copy of the live one.
 */
export function exportViewport(
  vp: Viewport,
  settings: FitExportSettings,
  content: Box | null,
  kind: BoardKind,
  /** The number line's items, so the strip can be as tall as its stack. */
  items: readonly NLItem[] = [],
  /**
   * Room to keep clear at the BOTTOM for a figure caption, in CSS px
   * (renderBoard's captionHeight()). 0 when there is no caption.
   *
   * The caption is drawn INSIDE the viewport — that is the rect the export
   * clips to — so a frame fitted tightly to the curves would print "Graph of f"
   * across the bottom of the curve. Reserving it does not change the output
   * SIZE or the aspect: the band is taken out of the fitted scale, exactly as
   * FIT_PAD is.
   */
  captionPx = 0,
): Viewport {
  const live: Viewport = {
    center: { x: vp.center.x, y: vp.center.y },
    pxPerUnit: vp.pxPerUnit,
    widthPx: Math.max(1, Math.round(vp.widthPx)),
    heightPx: Math.max(1, Math.round(vp.heightPx)),
  }
  if (!settings.fit || !content) return live
  // The lane layout depends on the horizontal scale, which for a number line
  // depends only on the width — so a first pass at the width alone answers it.
  let lanes = 1
  if (kind === 'number-line' && items.length > 0) {
    const probe = fitViewport(vp, content, kind, settings.aspect, 1)
    try {
      for (const l of nlLanes(items, probe)) lanes = Math.max(lanes, l.lane + 1)
    } catch {
      lanes = 1
    }
  }
  const fitted = fitViewport(vp, content, kind, settings.aspect, lanes)
  if (captionPx <= 0 || kind === 'number-line') return fitted
  // Two passes: the first says what a unit is worth, which is the only way to
  // state a band measured in pixels as the math room the frame has to give it.
  const band = captionPx / fitted.pxPerUnit
  return fitViewport(
    vp,
    { min: { x: content.min.x, y: content.min.y - band }, max: content.max },
    kind,
    settings.aspect,
    lanes,
  )
}

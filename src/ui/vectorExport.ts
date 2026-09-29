// ============================================================================
// src/ui/vectorExport.ts — the export FORMATS, and the one routine that turns
// an export scene into a vector display list.
//
//   PNG       the raster path, unchanged (renderBoardToCanvas).
//   SVG       the display list as SVG, sized in px by the same Output size /
//             Exact width settings as the PNG.
//   PDF       the display list as a one-page PDF, sized PHYSICALLY: the width
//             in cm the teacher states (default 8 cm), because a PDF figure
//             goes into \includegraphics and its labels must come out at a
//             legible point size at that width.
//   TikZ      the display list as a tikzpicture, sized physically likewise.
//   pgfplots  not the display list: a semantic axis environment built from
//             the scene (./pgfplotsExport.ts), sized physically likewise.
//
// PHYSICAL SIZING. A board is ~700–1200 CSS px wide; drawn at 8 cm its 11 px
// labels would be 3 pt. So the physical formats re-frame the SAME math window
// onto a viewport that is the stated width in CSS px (1 cm = 96/2.54 px, and
// 1 px = 0.75 pt), and the renderer lays the figure out at that size: tick
// spacing, label thinning and chip placement are decided for the paper the
// figure is going on — exactly as a PNG exported at that width would be — and
// an 11 px label becomes an 8.25 pt one.
//
// The composition is renderBoardToCanvas's, at scale 1: the ground over the
// whole figure, then the plot translated by the margin and clipped to its own
// rect, then renderBoard, then whatever the caller paints on top (the App's
// context markers) — so SVG/PDF/TikZ carry exactly what the PNG carries.
// ============================================================================

import type { Viewport } from '../core/types'
import type { BoardScene } from './renderBoard'
import { renderBoard } from './renderBoard'
import type { DisplayList } from '../render/vectorCtx'
import { VectorCtx } from '../render/vectorCtx'

export const EXPORT_FORMATS = ['png', 'svg', 'pdf', 'tikz', 'pgfplots'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

export const EXPORT_FORMAT_LABELS: Record<ExportFormat, string> = {
  png: 'PNG',
  svg: 'SVG',
  pdf: 'PDF',
  tikz: 'TikZ',
  pgfplots: 'pgfplots',
}

export const EXPORT_FORMAT_TITLES: Record<ExportFormat, string> = {
  png: 'A picture: for Word, Docs, slides',
  svg: 'Vector, sized in px: for the web, Illustrator, Inkscape',
  pdf: 'Vector, sized in cm: for \\includegraphics in LaTeX',
  tikz: 'The figure as TikZ commands: a .tex file you can \\input and edit',
  pgfplots: 'A pgfplots axis with the equations themselves: the most editable LaTeX',
}

export const FILE_EXTENSION: Record<ExportFormat, string> = {
  png: 'png',
  svg: 'svg',
  pdf: 'pdf',
  tikz: 'tex',
  pgfplots: 'tex',
}

export const isExportFormat = (v: unknown): v is ExportFormat =>
  typeof v === 'string' && (EXPORT_FORMATS as readonly string[]).includes(v)

/** The formats whose size is a physical width in cm. */
export const isPhysicalFormat = (f: ExportFormat): boolean => f === 'pdf' || f === 'tikz' || f === 'pgfplots'

/** The formats that are LaTeX source (download a .tex, offer Copy LaTeX). */
export const isLatexFormat = (f: ExportFormat): boolean => f === 'tikz' || f === 'pgfplots'

export const DEFAULT_LATEX_WIDTH_CM = 8
export const MIN_LATEX_WIDTH_CM = 3
export const MAX_LATEX_WIDTH_CM = 30

export function clampLatexWidth(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_LATEX_WIDTH_CM
  return Math.round(Math.min(MAX_LATEX_WIDTH_CM, Math.max(MIN_LATEX_WIDTH_CM, v)) * 10) / 10
}

/** CSS px per cm (96 px per inch). */
export const PX_PER_CM = 96 / 2.54

/**
 * The same math window on a viewport whose WHOLE figure (margins included) is
 * `widthCm` wide. The shape of the plot is kept; only its scale changes.
 */
export function physicalViewport(vp: Viewport, widthCm: number, marginPx: number): Viewport {
  const total = clampLatexWidth(widthCm) * PX_PER_CM
  const plotW = Math.max(40, total - 2 * Math.max(0, marginPx))
  const f = plotW / Math.max(1, vp.widthPx)
  return {
    ...vp,
    pxPerUnit: vp.pxPerUnit * f,
    ...(vp.pxPerUnitY !== undefined ? { pxPerUnitY: vp.pxPerUnitY * f } : {}),
    widthPx: plotW,
    heightPx: Math.max(1, vp.heightPx * f),
  }
}

/**
 * Record the export composition of a scene: the display list the SVG, PDF and
 * TikZ writers turn into files. `margin` is in CSS px; `paintExtra` draws on
 * top of the board inside the clipped, translated plot (the App's context
 * markers), exactly where renderExportCanvas draws them on the PNG.
 */
export function recordScene(
  scene: BoardScene,
  margin: number,
  paintExtra?: ((ctx: CanvasRenderingContext2D) => void) | null,
): DisplayList {
  const m = Math.max(0, margin)
  const W = Math.max(1, scene.vp.widthPx) + 2 * m
  const H = Math.max(1, scene.vp.heightPx) + 2 * m
  const rec = new VectorCtx(W, H)
  const ctx = rec as unknown as CanvasRenderingContext2D
  ctx.fillStyle = scene.theme.bg
  ctx.fillRect(0, 0, W, H)
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, m, m)
  ctx.beginPath()
  ctx.rect(0, 0, scene.vp.widthPx, scene.vp.heightPx)
  ctx.clip()
  renderBoard(ctx, scene)
  if (paintExtra) {
    try {
      paintExtra(ctx)
    } catch {
      /* extras are extras */
    }
  }
  ctx.restore()
  return rec.list()
}

/** A file name from the document name, with the format's extension. */
export function exportFileName(docName: string, format: ExportFormat): string {
  const safe = docName.replace(/[^\w\d\-. ]+/g, '_').trim()
  return `${safe || 'grapher'}.${FILE_EXTENSION[format]}`
}

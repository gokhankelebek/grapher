// ============================================================================
// src/ui/exportBackends.ts — the vector export writers, as one lazy module.
//
// The board never needs these to draw: SVG, PDF and TikZ write a display list
// recorded from renderBoard, and pgfplots writes the mathematics. useExport
// loads this on the first export (or in the idle prefetch after the first
// paint — src/ui/lazyLoad.tsx), so the workspace chunk does not carry them.
// ============================================================================

export { toPdf } from '../render/vectorPdf'
export { toSvg } from '../render/vectorSvg'
export { toTikz } from '../render/vectorTikz'
export { toPgfplots } from './pgfplotsExport'

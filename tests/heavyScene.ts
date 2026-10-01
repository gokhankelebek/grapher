// ============================================================================
// tests/heavyScene.ts — the heavy classroom board as a SCREEN scene, plus a
// no-op 2D context, for the benchmark and the cache regression tests.
//
// The scene is the document's own export scene (docFigure: analysis, the
// crossings, the area, the Riemann sum, the slope field and its solutions, the
// sign chart) redrawn the way the board draws it: dark theme, no figure style.
// ============================================================================

import { DARK_THEME } from '../src/core/types'
import type { BoardScene } from '../src/ui/renderBoard'
import { docFigure, docModelFromJSON } from '../src/ui/docScene'
import type { DocModel } from '../src/ui/docScene'
import { heavyJSON } from './heavyDoc'
import { MockPath2D } from './mockCanvas'

export function heavyModel(): DocModel {
  const m = docModelFromJSON(heavyJSON(), { screen: { widthPx: 1046, heightPx: 768 } })
  if (!m) throw new Error('heavy document did not load')
  return m
}

/** The board as the screen paints it: analysis on, crossings on, dark. */
export function heavyScreenScene(m: DocModel = heavyModel()): BoardScene {
  const f = docFigure(m, { style: 'screen', answers: true })
  return { ...f.scene, theme: DARK_THEME, figure: undefined, caption: undefined, answerKey: undefined }
}

/** A 2D context that does nothing — what the CPU pays for is the JS above it. */
export function nullCtx(): CanvasRenderingContext2D {
  const fns = new Set([
    'save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo',
    'arc', 'arcTo', 'ellipse', 'rect', 'fill', 'stroke', 'clip', 'fillRect', 'strokeRect', 'clearRect',
    'fillText', 'strokeText', 'setLineDash', 'translate', 'scale', 'rotate', 'setTransform', 'transform',
    'resetTransform', 'drawImage', 'putImageData', 'roundRect',
  ])
  const state: Record<string | symbol, unknown> = { canvas: { width: 2092, height: 1536 } }
  const noop = (): void => {}
  return new Proxy(state, {
    get(t, k) {
      if (k === 'measureText') return (s: string) => ({ width: s.length * 7, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 })
      if (k === 'getLineDash') return () => []
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop: noop })
      if (k === 'getTransform') return () => ({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 })
      if (typeof k === 'string' && fns.has(k)) return noop
      return t[k]
    },
    set(t, k, v) {
      t[k] = v
      return true
    },
  }) as unknown as CanvasRenderingContext2D
}

/** Path2D for node: the recording mock is enough (src/render never reads pixels). */
export function installPath2D(): void {
  const g = globalThis as unknown as { Path2D?: unknown }
  if (g.Path2D === undefined) g.Path2D = MockPath2D
}

// ============================================================================
// tests/heavyScene.bench.ts — per-frame CPU of the heavy classroom board.
//
//   npx vitest bench --run tests/heavyScene.bench.ts
//
// "frame"     renderBoard of an unchanged scene — a redraw with nothing moved
// "pan"       renderBoard with the window moved a few px every frame
// "derive"    docFigure: analysis, crossings, overlays, fields — what a slider
//             step re-derives when every memo misses
// A Chromebook is roughly 3–5× slower than this Mac: < ~8 ms here per frame is
// the budget for ~30 fps there.
// ============================================================================

import { bench, describe } from 'vitest'
import { renderBoard } from '../src/ui/renderBoard'
import { docFigure } from '../src/ui/docScene'
import { heavyModel, heavyScreenScene, installPath2D, nullCtx } from './heavyScene'

installPath2D()
const model = heavyModel()
const scene = heavyScreenScene(model)
const ctx = nullCtx()

describe('heavy classroom board', () => {
  bench('frame (nothing changed)', () => {
    renderBoard(ctx, scene)
  })
  let i = 0
  bench('pan (window moves every frame)', () => {
    i++
    renderBoard(ctx, { ...scene, vp: { ...scene.vp, center: { x: scene.vp.center.x + (i % 50) * 0.02, y: scene.vp.center.y } } })
  })
  let k = 0
  bench('slider step (sin amplitude moves)', () => {
    k++
    const curves = scene.curves.map((c) => (c.id === 'csin' ? { ...c, params: [1 + (k % 40) * 0.01, 1] } : c))
    renderBoard(ctx, { ...scene, curves })
  })
  bench('derive (docFigure: analysis + crossings + overlays)', () => {
    docFigure(model, { style: 'screen', answers: true })
  })
})

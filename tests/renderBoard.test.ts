// ============================================================================
// tests/renderBoard.test.ts — the export/screen render invariants.
//
// The bug this guards against: exportPNG used to be a PARALLEL COPY of the
// render path, so it silently drew only background + grid + curves. With the
// analysis layer on, the live canvas had 1460 label pixels and the export had
// ZERO. Both paths now share renderBoard(), and the difference between them is
// one field -- `chrome` -- so these tests pin that field's meaning.
// ============================================================================

import { describe, it, expect } from 'vitest'
import { renderBoard, type BoardScene, type BoardChrome } from '../src/ui/renderBoard'
import { MockCtx, withMockPath2D } from './mockCanvas'
import { MODELS } from '../src/core/fit/models'
import { analyzeCurve } from '../src/core/analyze'
import { getHandles } from '../src/core/fit/edit'
import { DARK_THEME, LIGHT_THEME, CURVE_COLORS, PRINT_CURVE_COLORS } from '../src/core/types'
import type { FittedCurve, Viewport } from '../src/core/types'

const VP: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 60, widthPx: 900, heightPx: 700 }

/** A cubic with three real zeros, a max, a min and an inflection to label. */
const CUBIC: FittedCurve = {
  id: 'c1', modelId: 'poly3',
  params: [2.1, -1.75, -0.7, 0.35],   // 0.35(x+2)(x-1)(x-3)
  kind: 'explicit', domain: [-3, 4],
  color: CURVE_COLORS[0], strokeWidth: 2.5, visible: true, error: 0.02,
}

function scene(over: Partial<BoardScene> = {}): BoardScene {
  return {
    vp: VP, theme: DARK_THEME, curves: [CUBIC], styles: {}, models: MODELS,
    analysis: { curve: CUBIC, points: analyzeCurve(CUBIC, MODELS) },
    ...over,
  }
}

function render(s: BoardScene): MockCtx {
  const ctx = new MockCtx()
  withMockPath2D(() => renderBoard(ctx as unknown as CanvasRenderingContext2D, s))
  return ctx
}

const chromeOn = (): BoardChrome => ({
  selectedId: CUBIC.id,
  handles: getHandles(CUBIC, MODELS),
  activeHandleId: null, highlight: null, openIdx: null, hoverIdx: null,
})

describe('renderBoard — what the export contains', () => {
  it('the analysis layer reaches the figure (the audit measured zero)', () => {
    const withAnalysis = render(scene({ chrome: null }))
    const without = render(scene({ chrome: null, analysis: null }))
    // markers are arcs; labels are fillText
    expect(withAnalysis.textCount, 'no analysis labels drawn').toBeGreaterThan(0)
    expect(withAnalysis.textCount).toBeGreaterThan(without.textCount)
  })

  it('a cubic contributes every feature kind it has', () => {
    const pts = analyzeCurve(CUBIC, MODELS)
    const kinds = new Set(pts.map(p => p.kind))
    expect(kinds.has('zero')).toBe(true)
    expect(kinds.has('maximum')).toBe(true)
    expect(kinds.has('minimum')).toBe(true)
    expect(kinds.has('inflection')).toBe(true)
  })
})

describe('renderBoard — chrome is the only difference between screen and export', () => {
  it('chrome:null draws strictly less than chrome-on, and the curve survives', () => {
    const figure = render(scene({ chrome: null }))
    const editing = render(scene({ chrome: chromeOn() }))
    expect(editing.strokeCount).toBeGreaterThan(figure.strokeCount)
    expect(figure.strokeCount, 'the curve itself must still be drawn').toBeGreaterThan(0)
  })

  it('handles are editing chrome and never reach the export', () => {
    const handles = getHandles(CUBIC, MODELS)
    expect(handles.length, 'fixture must have handles to exclude').toBeGreaterThan(0)
    const figure = render(scene({ chrome: null }))
    const editing = render(scene({ chrome: chromeOn() }))
    // handles are drawn as arcs; the export must have strictly fewer
    expect(editing.arcCount).toBeGreaterThan(figure.arcCount)
  })

  it('in-progress ink never reaches the export', () => {
    const ink = { pts: [{ x: -1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 0 }], color: '#fff' }
    const figure = render(scene({ chrome: null }))
    const drawing = render(scene({ chrome: { ...chromeOn(), ink } }))
    expect(drawing.strokeCount).toBeGreaterThan(figure.strokeCount)
  })
})

describe('renderBoard — print colours', () => {
  it('printColors swaps the screen palette for its print counterpart', () => {
    const screen = render(scene({ chrome: null, theme: DARK_THEME }))
    const print = render(scene({ chrome: null, theme: LIGHT_THEME, printColors: true }))
    expect(screen.strokeStyles).toContain(CURVE_COLORS[0])
    expect(print.strokeStyles).toContain(PRINT_CURVE_COLORS[0])
    expect(print.strokeStyles, 'screen colour leaked into the print figure')
      .not.toContain(CURVE_COLORS[0])
  })

  it('without printColors the screen palette is kept', () => {
    const asIs = render(scene({ chrome: null, printColors: false }))
    expect(asIs.strokeStyles).toContain(CURVE_COLORS[0])
    expect(asIs.strokeStyles).not.toContain(PRINT_CURVE_COLORS[0])
  })
})

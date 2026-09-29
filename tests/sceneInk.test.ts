// The export paints the OTHER curves' markers onto its picture from outside
// renderBoard; they must take the figure's ink — black under SAT/AP, never
// the curve's own red on a figure that is otherwise one ink.
import { describe, it, expect } from 'vitest'
import { DARK_THEME, FIGURE_STYLES, LIGHT_THEME, toPrintColor } from '../src/core/types'
import type { BoardScene } from '../src/ui/renderBoard'
import { sceneInk } from '../src/ui/renderBoard'

const base = (over: Partial<BoardScene>): BoardScene =>
  ({
    vp: { center: { x: 0, y: 0 }, pxPerUnit: 40, widthPx: 400, heightPx: 300 },
    curves: [],
    models: {},
    theme: DARK_THEME,
    ...over,
  }) as BoardScene

describe('sceneInk — the colour of marks painted onto a finished figure', () => {
  it('mono styles (SAT, AP) paint every curve in the axis black', () => {
    for (const f of [FIGURE_STYLES.sat, FIGURE_STYLES.ap]) {
      const ink = sceneInk(base({ figure: f, theme: LIGHT_THEME }))
      expect(ink('#ef4444')).toBe(LIGHT_THEME.axis)
      expect(ink('#4f9cf9')).toBe(LIGHT_THEME.axis)
    }
  })
  it('a light ground uses the print palette, a dark screen the curve colour itself', () => {
    expect(sceneInk(base({ theme: LIGHT_THEME }))('#4f9cf9')).toBe(toPrintColor('#4f9cf9'))
    expect(sceneInk(base({ theme: DARK_THEME }))('#4f9cf9')).toBe('#4f9cf9')
  })
})

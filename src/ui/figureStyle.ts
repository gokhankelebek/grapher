// ============================================================================
// src/ui/figureStyle.ts — WHICH LOOK the board is drawn in.
//
// The style bundle itself is the contract in core/types.ts (FIGURE_STYLES);
// this is the App's half: the order the picker offers them in, the sentence
// each one says about itself, the caption a style starts with, and the tiny
// sample scene the thumbnails are drawn from.
//
// The thumbnails are rendered through renderBoard itself rather than drawn as
// icons, so the picture in the panel IS the look — an icon would be a promise
// about the renderer that nothing checks, and the one thing a teacher is
// choosing here is what the PNG will look like.
//
// 'screen' is deliberately the absence of a style: `figureFor` returns
// undefined for it, so a board nobody has restyled hands the renderer a scene
// with no `figure` field at all and draws the identical command stream it drew
// before any of this existed.
//
// Pure: no React, no DOM. The canvas work lives in FigurePicker.tsx.
// ============================================================================

import { CURVE_COLORS, FIGURE_STYLES } from '../core/types'
import type { FigureStyle, FigureStyleId, FittedCurve, Theme, Viewport } from '../core/types'
import { MODELS } from '../core/fit/models'
import type { BoardScene } from './renderBoard'

/** The four looks, in the order the picker shows them. */
export const FIGURE_CHOICES: readonly FigureStyleId[] = ['screen', 'textbook', 'sat', 'ap']

/**
 * One line naming what the style DOES, under the picker.
 *
 * Taken from the contract comment, because the thumbnail can show that the
 * board goes white and cannot show that every curve goes black — and "why did
 * my red curve print black" is the question this line exists to answer before
 * it is asked.
 */
export const FIGURE_BLURB: Record<FigureStyleId, string> = {
  screen: 'Screen — the board as you work on it: your theme, your curve colours',
  textbook: 'Textbook — white, unit grid, black axes, curves in print colours',
  sat: 'SAT — unit grid, black axes, a number on every tick, all curves black',
  ap: 'AP Calculus — white, no grid: bare axes with ticks, O at the origin, all curves black',
}

/**
 * What the caption field starts at when a style is chosen.
 *
 * Only the AP look has one, because only the AP look is a figure that is
 * REFERRED to — "The graph of f is shown above" is the sentence the item
 * itself will be written in. It is a starting point, never a rule: the teacher
 * can clear it or write something else, and a cleared caption stays cleared.
 */
export const DEFAULT_CAPTION: Record<FigureStyleId, string> = {
  screen: '',
  textbook: '',
  sat: '',
  ap: 'Graph of f',
}

/**
 * The style to hand the renderer, or undefined for the screen look.
 *
 * Undefined rather than FIGURE_STYLES.screen on purpose: absent IS the screen
 * look, and it is the only value that keeps the byte-identical render path —
 * including the dark/light theme toggle, which a style would override.
 */
export function figureFor(id: FigureStyleId): FigureStyle | undefined {
  return id === 'screen' ? undefined : FIGURE_STYLES[id]
}

/**
 * The ground a board in this style is drawn on.
 *
 * The screen look keeps whatever the theme toggle says; every other style is
 * white, and says so on screen as well as in the PNG — the whole point of
 * choosing the look is that what is on the board is what goes on the paper.
 */
export function figureTheme(id: FigureStyleId, screen: Theme): Theme {
  return id === 'screen' ? screen : FIGURE_STYLES[id].theme
}

/** True when the style fixes the ground, so the export's Background is moot. */
export const fixesBackground = (id: FigureStyleId): boolean => id !== 'screen'

/** Why the Background control is disabled, in the style's own words. */
export function backgroundLockedNote(id: FigureStyleId): string {
  return `The ${FIGURE_STYLES[id].name} style is always on white.`
}

// ------------------------------------------------------------- the sample
//
// One parabola and a few ticks, in a window small enough that a 96x64 thumbnail
// shows a grid rather than a texture. Deliberately NOT the teacher's own board:
// a thumbnail of an empty board says nothing about the curve ink, and a
// thumbnail of a busy one says nothing at all.

/** y = 0.5x² − 1.2, as the poly2 family states it (coefficients ascending). */
const SAMPLE_CURVE: FittedCurve = {
  id: 'sample',
  modelId: 'poly2',
  params: [-1.2, 0, 0.5],
  kind: 'explicit',
  domain: [-2.6, 2.6],
  color: CURVE_COLORS[0],
  strokeWidth: 2,
  visible: true,
  error: 0,
}

/** px per unit in the sample window: ~14 puts 5 units across a 96px thumbnail. */
export const SAMPLE_PPU = 14

export function sampleViewport(widthPx: number, heightPx: number): Viewport {
  return { center: { x: 0, y: 0 }, pxPerUnit: SAMPLE_PPU, widthPx, heightPx }
}

/**
 * The scene one thumbnail draws.
 *
 * `screen` is handed the live board theme, so the Screen thumbnail follows the
 * dark/light toggle exactly as the board does; every other style carries its
 * own ground. No chrome: a thumbnail is a figure, not a board being edited.
 */
export function sampleScene(
  id: FigureStyleId,
  screenTheme: Theme,
  widthPx: number,
  heightPx: number,
): BoardScene {
  const figure = figureFor(id)
  const scene: BoardScene = {
    vp: sampleViewport(widthPx, heightPx),
    theme: figureTheme(id, screenTheme),
    curves: [SAMPLE_CURVE],
    styles: {},
    models: MODELS,
    chrome: null,
  }
  if (figure) scene.figure = figure
  return scene
}

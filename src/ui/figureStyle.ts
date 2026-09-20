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
// A STYLE IS OUTPUT-ONLY. It is what the PNG and the clipboard copy come out
// looking like; the board the teacher draws on keeps its own look — the dark
// theme with the neon sketches, or the light one — and so does presentation
// mode, where the board is on a wall and an SAT figure would be a white
// rectangle in a dark room. `screenLook` and `exportLook` are the two answers,
// and they are separate functions precisely so the board cannot quietly pick
// up the export's ground the way it used to.
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
  screen: 'Screen — the PNG comes out as the board looks: your theme, your curve colours',
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
 * The ground a figure in this style is drawn on.
 *
 * The screen look keeps whatever the theme toggle says; every other style is
 * white. Used for the EXPORT, for the picker's thumbnails, and for the board
 * only while it is being previewed — see `screenLook`.
 */
export function figureTheme(id: FigureStyleId, screen: Theme): Theme {
  return id === 'screen' ? screen : FIGURE_STYLES[id].theme
}

/** True when the style fixes the ground, so the export's Background is moot. */
export const fixesBackground = (id: FigureStyleId): boolean => id !== 'screen'

/** Why the Background control is disabled, in the style's own words. */
export function backgroundLockedNote(id: FigureStyleId): string {
  return `The ${FIGURE_STYLES[id].name} style always exports on white.`
}

// --------------------------------------------------- what each scene carries
//
// Two destinations, two answers. The board is a place to WORK; the PNG is the
// thing the work is for. Conflating them meant a teacher who wanted an SAT
// export had to sketch on white with black curves, which is the one place the
// neon-on-dark board earns its keep.

/** What a scene drawn on SCREEN carries. */
export interface ScreenLook {
  /**
   * The style the board scene carries — normally undefined, which IS the
   * screen look and the byte-identical render path.
   */
  figure: FigureStyle | undefined
  /** The line under the figure; '' means the scene carries none. */
  caption: string
  /** The ground: the theme toggle's, unless a preview has taken it over. */
  theme: Theme
  /** True when the board is showing the export's look instead of the theme. */
  previewing: boolean
}

/**
 * What the board on screen draws, given the document's style and the preview
 * switch.
 *
 * The style alone changes NOTHING here: that is the whole decision. The board
 * takes the figure only when the teacher has explicitly asked to see it, with
 * the non-persisted "Preview on board" switch, and even then not in
 * presentation mode — a presented board is a lit wall, and the point of the
 * preview is to check what a sheet of paper will look like.
 *
 * A number-line board has no figure style at all: the styles are described in
 * grids, axes and ticks, and the picker is not offered on one.
 */
export function screenLook(o: {
  style: FigureStyleId
  caption: string
  screenTheme: Theme
  preview: boolean
  present: boolean
  cartesian: boolean
}): ScreenLook {
  const figure = o.cartesian && o.preview && !o.present ? figureFor(o.style) : undefined
  return {
    figure,
    caption: figure ? o.caption : '',
    theme: figure ? figure.theme : o.screenTheme,
    previewing: figure !== undefined,
  }
}

/** What the exported PNG — and the clipboard copy, which is the same scene —
 *  carries. The preview switch has no say here: it is a way of LOOKING at this
 *  answer, never a way of changing it. */
export interface ExportLook {
  figure: FigureStyle | undefined
  caption: string
}

export function exportLook(o: {
  style: FigureStyleId
  caption: string
  cartesian: boolean
}): ExportLook {
  if (!o.cartesian) return { figure: undefined, caption: '' }
  return { figure: figureFor(o.style), caption: o.caption }
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

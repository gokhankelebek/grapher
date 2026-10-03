// ============================================================================
// src/core/a11yPalette.ts — the colour-blind-safe curve palette (opt-in).
//
// "Curve colours: Standard / Colour-blind safe" is a PREFERENCE, not a
// property of a document: the colours stored on curves stay the standard
// palette's, byte for byte, and this module maps them at paint time — index
// for index, the same way toPrintColor maps the screen palette to the print
// one. A curve therefore keeps its identity across the switch, across screen
// and paper, and a document opened on another machine looks the way that
// person asked for.
//
// The safe palette is built on Okabe & Ito's eight colours (2008), chosen to
// stay distinguishable under protanopia, deuteranopia and tritanopia. Two
// versions, index for index:
//
//   SAFE_CURVE_COLORS        on the dark board (Okabe–Ito; its black becomes
//                            a near-white, since black on #0f1117 is nothing)
//   SAFE_PRINT_CURVE_COLORS  on white paper / a light ground (the same hues,
//                            darkened until each clears 4:1 on white)
//
// Every colour is ≥ 3:1 against its ground (WCAG 1.4.11, graphical objects);
// tests/a11yPalette.test.ts measures them. Colour is never the only cue: with
// the safe palette on, every visible curve also takes a distinct dash pattern
// (src/ui/dashes.ts — the item bank's house dashes).
// ============================================================================

import { CURVE_COLORS, PRINT_CURVE_COLORS, toPrintColor } from './types'

export type CurvePalette = 'standard' | 'safe'

export const CURVE_PALETTES: readonly CurvePalette[] = ['standard', 'safe']

export function isCurvePalette(v: unknown): v is CurvePalette {
  return v === 'standard' || v === 'safe'
}

/**
 * On the dark board, index for index with CURVE_COLORS
 * (blue, red, green, amber, purple, teal, pink, lime).
 */
export const SAFE_CURVE_COLORS: readonly string[] = [
  '#56b4e9', // sky blue        8.2:1 on #0f1117
  '#d55e00', // vermillion      4.9:1
  '#009e73', // bluish green    5.5:1
  '#e69f00', // orange          8.4:1
  '#cc79a7', // reddish purple  6.2:1
  '#f0e442', // yellow         14.3:1
  '#0072b2', // blue            3.6:1
  '#eeeeee', // near-white (Okabe–Ito's black, on a dark ground) 16.3:1
]

/** On white, index for index with SAFE_CURVE_COLORS. */
export const SAFE_PRINT_CURVE_COLORS: readonly string[] = [
  '#2b7fb8', // sky blue, darkened   4.4:1 on #ffffff
  '#c25400', // vermillion           4.6:1
  '#00845f', // bluish green         4.7:1
  '#a86f00', // orange               4.3:1
  '#b0558a', // reddish purple       4.7:1
  '#857600', // yellow → olive       4.6:1
  '#003c78', // blue → navy         11.6:1
  '#000000', // black               21:1
]

/** A curve's colour index in the standard palette (screen or print), or -1. */
function paletteIndex(color: string): number {
  const c = color.toLowerCase()
  const i = CURVE_COLORS.indexOf(c)
  if (i >= 0) return i
  return PRINT_CURVE_COLORS.indexOf(c)
}

/**
 * The colour a curve is painted in: `print` says the ground is light (or the
 * figure is for paper); `palette` is the person's choice. Colours that are
 * not in the curve palette (a construction's grey, an accent) pass through
 * the standard rule unchanged.
 */
export function curveInk(color: string, print: boolean, palette: CurvePalette = 'standard'): string {
  if (palette === 'safe') {
    const i = paletteIndex(color)
    if (i >= 0) return (print ? SAFE_PRINT_CURVE_COLORS : SAFE_CURVE_COLORS)[i]
  }
  return print ? toPrintColor(color) : color
}

/** curveInk as a function of the colour alone. */
export function inkMapper(print: boolean, palette: CurvePalette = 'standard'): (color: string) => string {
  if (palette !== 'safe') return print ? toPrintColor : (c: string): string => c
  return (c: string): string => curveInk(c, print, palette)
}

// ----------------------------------------------------------------------------
// WCAG contrast
// ----------------------------------------------------------------------------

/** WCAG relative luminance of #rgb / #rrggbb; NaN for anything else. */
export function relativeLuminance(hex: string): number {
  let h = hex.trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map((c) => c + c).join('')
  if (!/^[0-9a-f]{6}$/i.test(h)) return Number.NaN
  const n = parseInt(h, 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}

/** WCAG contrast ratio between two opaque colours (1 … 21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** An opaque colour `fg` at `alpha` over `bg`, as #rrggbb. */
export function blend(fg: string, bg: string, alpha: number): string {
  const p = (h: string): number[] => {
    let s = h.trim().replace(/^#/, '')
    if (s.length === 3) s = s.split('').map((c) => c + c).join('')
    const n = parseInt(s, 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const f = p(fg)
  const g = p(bg)
  const a = Math.max(0, Math.min(1, alpha))
  return `#${f.map((v, i) => Math.round(v * a + g[i] * (1 - a)).toString(16).padStart(2, '0')).join('')}`
}

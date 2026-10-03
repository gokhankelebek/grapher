// ============================================================================
// tests/a11yPalette.test.ts — the colour-blind-safe palette (opt-in) and the
// dash pattern every curve takes with it (src/core/a11yPalette.ts,
// src/ui/dashes.ts, renderBoard's scene field `inkPalette`).
// ============================================================================

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  SAFE_CURVE_COLORS,
  SAFE_PRINT_CURVE_COLORS,
  blend,
  contrastRatio,
  curveInk,
  inkMapper,
  isCurvePalette,
  relativeLuminance,
} from '../src/core/a11yPalette'
import { CURVE_COLORS, DARK_THEME, FIGURE_STYLES, LIGHT_THEME, PRINT_CURVE_COLORS, toPrintColor } from '../src/core/types'
import type { FittedCurve } from '../src/core/types'
import type { StyleMap } from '../src/core/persist'
import { A11Y_DASHES, HOUSE_DASHES, houseDashes, paletteDashes } from '../src/ui/dashes'
import { HOUSE_DASHES as BANK_DASHES, houseDashes as bankHouseDashes } from '../src/ui/itemBank'
import { sceneInk, withPaletteStyles } from '../src/ui/renderBoard'
import type { BoardScene } from '../src/ui/renderBoard'
import { ExampleBoard } from '../src/examples/builder'
import { serializeDoc } from '../src/core/persist'
import { docFigure, docModelFromJSON } from '../src/ui/docScene'
import { recordScene } from '../src/ui/vectorExport'
import type { PathItem } from '../src/render/vectorCtx'
import { readPrefs } from '../src/ui/storage'

const hex = (c: { r: number; g: number; b: number }): string =>
  `#${[c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`

// ---------------------------------------------------------------------------
// contrast
// ---------------------------------------------------------------------------

describe('WCAG contrast helpers', () => {
  it('measure the textbook pairs', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2)
    expect(relativeLuminance('#fff')).toBeCloseTo(1, 6)
    expect(Number.isNaN(relativeLuminance('nope'))).toBe(true)
    expect(blend('#ffffff', '#000000', 0.5)).toBe('#808080')
  })
})

describe('the colour-blind-safe palette is readable on every ground (WCAG 1.4.11, ≥ 3:1)', () => {
  it('has one safe colour per curve colour, screen and print, index for index', () => {
    expect(SAFE_CURVE_COLORS).toHaveLength(CURVE_COLORS.length)
    expect(SAFE_PRINT_CURVE_COLORS).toHaveLength(CURVE_COLORS.length)
    expect(new Set(SAFE_CURVE_COLORS).size).toBe(SAFE_CURVE_COLORS.length)
    expect(new Set(SAFE_PRINT_CURVE_COLORS).size).toBe(SAFE_PRINT_CURVE_COLORS.length)
  })

  it('every screen colour clears 3:1 on the dark board', () => {
    for (const c of SAFE_CURVE_COLORS) {
      expect(contrastRatio(c, DARK_THEME.bg), `${c} on ${DARK_THEME.bg}`).toBeGreaterThanOrEqual(3)
    }
  })

  it('every print colour clears 4:1 on white and on every figure style’s paper', () => {
    const grounds = new Set([LIGHT_THEME.bg, ...Object.values(FIGURE_STYLES).map((f) => f.theme.bg).filter((bg) => relativeLuminance(bg) > 0.5)])
    for (const bg of grounds) {
      for (const c of SAFE_PRINT_CURVE_COLORS) {
        expect(contrastRatio(c, bg), `${c} on ${bg}`).toBeGreaterThanOrEqual(4)
      }
    }
  })

  it('the safe screen colours would NOT all survive white paper — which is why there is a print half', () => {
    expect(SAFE_CURVE_COLORS.some((c) => contrastRatio(c, '#ffffff') < 3)).toBe(true)
  })

  it('the safe print colours step apart in lightness, so a photocopy still separates most of them', () => {
    const lum = SAFE_PRINT_CURVE_COLORS.map(relativeLuminance).sort((a, b) => a - b)
    expect(lum[lum.length - 1] - lum[0]).toBeGreaterThan(0.15)
  })
})

describe('curveInk: the standard palette is untouched, the safe one maps by index', () => {
  it('standard: identity on screen, toPrintColor on paper', () => {
    for (const c of CURVE_COLORS) {
      expect(curveInk(c, false)).toBe(c)
      expect(curveInk(c, true)).toBe(toPrintColor(c))
      expect(inkMapper(false)(c)).toBe(c)
      expect(inkMapper(true)(c)).toBe(toPrintColor(c))
    }
  })

  it('safe: CURVE_COLORS[i] → SAFE_CURVE_COLORS[i] on screen, SAFE_PRINT_CURVE_COLORS[i] on paper', () => {
    CURVE_COLORS.forEach((c, i) => {
      expect(curveInk(c, false, 'safe')).toBe(SAFE_CURVE_COLORS[i])
      expect(curveInk(c, true, 'safe')).toBe(SAFE_PRINT_CURVE_COLORS[i])
      // a colour already in its print form maps the same way
      expect(curveInk(PRINT_CURVE_COLORS[i], true, 'safe')).toBe(SAFE_PRINT_CURVE_COLORS[i])
    })
    expect(curveInk(CURVE_COLORS[0].toUpperCase(), false, 'safe')).toBe(SAFE_CURVE_COLORS[0])
  })

  it('a colour outside the palette (an accent, a grey) passes through the standard rule', () => {
    expect(curveInk('#9aa4b2', false, 'safe')).toBe('#9aa4b2')
    expect(curveInk('#9aa4b2', true, 'safe')).toBe(toPrintColor('#9aa4b2'))
  })

  it('sceneInk follows the scene’s palette', () => {
    const base = { theme: DARK_THEME } as unknown as BoardScene
    expect(sceneInk(base)(CURVE_COLORS[3])).toBe(CURVE_COLORS[3])
    expect(sceneInk({ ...base, inkPalette: 'safe' })(CURVE_COLORS[3])).toBe(SAFE_CURVE_COLORS[3])
    expect(sceneInk({ ...base, theme: LIGHT_THEME, inkPalette: 'safe' })(CURVE_COLORS[3])).toBe(SAFE_PRINT_CURVE_COLORS[3])
  })

  it('the preference defaults to standard and only reads a known value', () => {
    expect(readPrefs().curvePalette).toBe('standard')
    expect(isCurvePalette('safe')).toBe(true)
    expect(isCurvePalette('neon')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// dashes
// ---------------------------------------------------------------------------

const curve = (id: string, visible = true): FittedCurve =>
  ({ id, kind: 'explicit', modelId: 'line', params: [1, 0], color: CURVE_COLORS[0], visible, error: 0, domain: null }) as unknown as FittedCurve

const key = (d: readonly number[] | undefined): string => (d && d.length ? d.join(',') : 'solid')

describe('dash assignment: every visible curve its own pattern', () => {
  it('six curves, six different patterns, the first one solid', () => {
    const cs = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => curve(id))
    const out = paletteDashes(cs, {})
    const pats = cs.map((c) => key(out[c.id]?.dash))
    expect(new Set(pats).size).toBe(6)
    expect(pats[0]).toBe('solid')
    expect(A11Y_DASHES.slice(0, HOUSE_DASHES.length)).toEqual(HOUSE_DASHES)
  })

  it('a dash the teacher chose is kept, and nobody else takes it', () => {
    const cs = ['a', 'b', 'c'].map((id) => curve(id))
    const styles: StyleMap = { b: { dash: [8, 6] } }
    const out = paletteDashes(cs, styles)
    expect(out.b.dash).toEqual([8, 6])
    expect(key(out.a.dash)).not.toBe('8,6')
    expect(key(out.c.dash)).not.toBe('8,6')
    expect(key(out.a.dash)).not.toBe(key(out.c.dash))
  })

  it('hidden curves take no pattern, and the input styles are not changed', () => {
    const cs = [curve('a'), curve('b', false), curve('c')]
    const styles: StyleMap = {}
    const out = paletteDashes(cs, styles)
    expect(out.b).toBeUndefined()
    expect(styles).toEqual({})
  })

  it('the item bank still exports the same house dashes (moved, not changed)', () => {
    expect(BANK_DASHES).toBe(HOUSE_DASHES)
    expect(bankHouseDashes).toBe(houseDashes)
  })

  it('withPaletteStyles: standard scenes are the same object; safe scenes get the dashes', () => {
    const scene = { curves: [curve('a'), curve('b')], styles: {}, theme: DARK_THEME } as unknown as BoardScene
    expect(withPaletteStyles(scene)).toBe(scene)
    const safe = withPaletteStyles({ ...scene, inkPalette: 'safe' })
    expect(key(safe.styles.a?.dash)).not.toBe(key(safe.styles.b?.dash))
    expect(withPaletteStyles({ ...scene, inkPalette: 'safe', kind: 'number-line' }).styles).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// the figure itself
// ---------------------------------------------------------------------------

function threeLines(): BoardScene {
  const b = new ExampleBoard()
  b.frame([-5, 5], [-5, 5])
  b.line('f(x) = x^2 - 2')
  b.line('g(x) = x + 1')
  b.line('h(x) = 2 - x^2 / 4')
  const m = docModelFromJSON(serializeDoc(b.toDoc('doc-a11y', 'A11y')))
  if (!m) throw new Error('no model')
  const fig = docFigure(m, { style: 'screen', answers: false, caption: '' })
  return { ...fig.scene, theme: DARK_THEME, printColors: false }
}

/** The long strokes of the figure (the curves), by colour → dash patterns seen. */
function curveStrokes(scene: BoardScene): Map<string, Set<string>> {
  const list = recordScene(scene, 0)
  const out = new Map<string, Set<string>>()
  for (const it of list.items) {
    if (it.t !== 'path' || !(it as PathItem).stroke) continue
    const p = it as PathItem
    if (p.segs.length < 20) continue
    const c = hex(p.stroke!.color)
    if (!out.has(c)) out.set(c, new Set())
    out.get(c)!.add(p.stroke!.dash.length ? 'dashed' : 'solid')
  }
  return out
}

describe('the board draws the safe palette only when asked', () => {
  it('standard: the neon colours, every curve solid — the default look is unchanged', () => {
    const strokes = curveStrokes(threeLines())
    const colours = [...strokes.keys()]
    for (const c of CURVE_COLORS.slice(0, 3)) expect(colours).toContain(c)
    for (const c of SAFE_CURVE_COLORS) expect(colours).not.toContain(c)
    for (const c of CURVE_COLORS.slice(0, 3)) expect([...strokes.get(c)!]).toEqual(['solid'])
  })

  it('safe: the Okabe–Ito colours, and two of the three curves dashed', () => {
    const strokes = curveStrokes({ ...threeLines(), inkPalette: 'safe' })
    const colours = [...strokes.keys()]
    for (const c of SAFE_CURVE_COLORS.slice(0, 3)) expect(colours).toContain(c)
    for (const c of CURVE_COLORS.slice(0, 3)) expect(colours).not.toContain(c)
    const dashed = SAFE_CURVE_COLORS.slice(0, 3).filter((c) => strokes.get(c)!.has('dashed'))
    expect(dashed).toHaveLength(2)
  })

  it('safe on paper: the print half of the palette', () => {
    const strokes = curveStrokes({ ...threeLines(), theme: LIGHT_THEME, inkPalette: 'safe' })
    for (const c of SAFE_PRINT_CURVE_COLORS.slice(0, 3)) expect([...strokes.keys()]).toContain(c)
  })
})

describe('pass / fail is never colour alone', () => {
  it('the horizontal line test carries ✓ / ✗ as well as green / orange', async () => {
    const { hltVerdict } = await import('../src/ui/domainLinks')
    expect(hltVerdict([1, 2]).glyph).toBe('✗')
    expect(hltVerdict([1]).glyph).toBe('✓')
    expect(hltVerdict([]).glyph).toBe('✓')
  })

  it('on the board under the safe palette: a failing line is dashed and labelled', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/app/useBoardOverlays.ts', import.meta.url)), 'utf8')
    expect(src).toMatch(/safe && v\.fails \? \{ dashed: true \}/)
    expect(src).toContain('text: `${v.glyph} ${v.chip}`')
  })

  it('the card says it too', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/ui/DomainSection.tsx', import.meta.url)), 'utf8')
    expect(src).toContain('{hlt.verdict.glyph} ')
  })
})

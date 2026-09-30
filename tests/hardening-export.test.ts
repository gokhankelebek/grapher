// ============================================================================
// tests/hardening-export.test.ts — regressions from the export review.
//
//   1. no control character (the `\f` of an unescaped "\fill") in any export;
//   2. pgfplots keeps the unit circle, and says what it leaves out;
//   3. ✓ / ✗ are real glyphs in TeX and PDF, never "?";
//   4. prose punctuation inside mathematics never becomes "?";
//   5. no TikZ coordinate past what TeX can hold (tan⁻¹(1000));
//   6. a pan inside the pad reuses the cached inequality shading;
//   7. a long caption wraps inside the plot, and its band is reserved.
// ============================================================================

import { describe, expect, it } from 'vitest'
import type { FittedCurve, ModelSpec } from '../src/core/types'
import { DARK_THEME, LIGHT_THEME } from '../src/core/types'
import { parseExpression } from '../src/core/parse'
import { renderBoard, captionHeight, captionLayout, CAPTION_MAX_LINES, CAPTION_SIDE } from '../src/ui/renderBoard'
import type { BoardScene } from '../src/ui/renderBoard'
import { recordScene } from '../src/ui/vectorExport'
import { toSvg } from '../src/render/vectorSvg'
import { pdfTextRuns, toPdfString } from '../src/render/vectorPdf'
import { TIKZ_MAX_PT, fitSegs, toTikz } from '../src/render/vectorTikz'
import type { TextItem } from '../src/render/vectorCtx'
import { recordDrawing } from '../src/render/vectorCtx'
import { texLabel, texMath } from '../src/render/texText'
import { toPgfplots } from '../src/ui/pgfplotsExport'
import { UC_SHOW_DEFAULT } from '../src/core/persist'
import type { BoardUnitCircle } from '../src/core/persist'
import { newUnitCircle, unitCircleFigure } from '../src/ui/unitCircleLinks'
import { MODELS } from '../src/core/fit/models'
import { clearInequalityCache, inequalityOf, regionOnView } from '../src/render/inequalities'
import { MockCtx, withMockPath2D } from './mockCanvas'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function typed(id: string, src: string, color = '#4f9cf9'): { curve: FittedCurve; spec: ModelSpec } {
  const o = parseExpression(src)
  if (!o.ok) throw new Error(src)
  const spec = o.plot.makeModel(`expr_${id}`)
  return {
    spec,
    curve: {
      id,
      modelId: `expr_${id}`,
      params: o.plot.defaultParams.slice(),
      kind: o.plot.kind,
      domain: o.plot.domain,
      color,
      strokeWidth: 2.5,
      visible: true,
      error: 0,
    },
  }
}

function boardOf(srcs: string[]): { curves: FittedCurve[]; models: Record<string, ModelSpec> } {
  const curves: FittedCurve[] = []
  const models: Record<string, ModelSpec> = { ...MODELS }
  srcs.forEach((s, i) => {
    const t = typed(`c${i + 1}`, s)
    curves.push(t.curve)
    models[t.curve.modelId] = t.spec
  })
  return { curves, models }
}

function uc(over: Partial<BoardUnitCircle> = {}): BoardUnitCircle {
  return { ...newUnitCircle('U1'), ...over }
}

const VP = { center: { x: 0, y: 0 }, pxPerUnit: 40, widthPx: 600, heightPx: 400 }

function scene(srcs: string[], over: Partial<BoardScene> = {}): BoardScene {
  const { curves, models } = boardOf(srcs)
  return { vp: VP, theme: LIGHT_THEME, curves, styles: {}, models, analysis: null, chrome: null, ...over }
}

/** Every C0 control character and DEL, except \n. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f]/

function controls(s: string): string[] {
  const out: string[] = []
  for (let i = 0; i < s.length; i++) if (CONTROL.test(s[i])) out.push(`${s.charCodeAt(i)}@${i}`)
  return out
}

/** A board with one of everything the review found: inequality, test point, unit circle, caption. */
function kitchenSink(): BoardScene {
  const circle = unitCircleFigure(uc({ theta: Math.PI / 6, show: { ...UC_SHOW_DEFAULT, tan: true } }))
  return scene(['y < x^2 - 4', 'y >= 2x + 1'], {
    inequalitySolution: true,
    overlays: [
      { kind: 'dot', at: { x: 1, y: 2 }, color: '#c01c28' },
      { kind: 'label', at: { x: 1, y: 2 }, text: '(1, 2) ✓', dir: { x: 0.7, y: -0.7 }, color: '#c01c28' },
      { kind: 'label', at: { x: -2, y: 3 }, text: '(0, 0) ✗', dir: { x: 0.7, y: -0.7 }, color: '#c01c28' },
    ],
    unitCircles: [circle],
    caption: 'Graph of f\fand g\tthe “solution” region — shaded',
  })
}

// ---------------------------------------------------------------------------
// 1. Control characters
// ---------------------------------------------------------------------------

describe('1. no export contains a control character', () => {
  it('pgfplots writes \\fill, not a form feed', () => {
    const tex = toPgfplots(scene(['y < x^2 - 4']), { sources: { c1: 'y < x^2 - 4' } })
    expect(tex).toContain('\\fill[')
    expect(tex).not.toContain('\f')
  })

  it('pgfplots, TikZ, SVG and PDF of a full board: only \\n', () => {
    const s = kitchenSink()
    const outs: Record<string, string> = {
      pgfplots: toPgfplots(s, { sources: { c1: 'y < x^2 - 4', c2: 'y >= 2x + 1' }, title: 'a\fb' }),
      tikz: toTikz(recordScene(s, 16), { title: 'a\fb' }),
      svg: toSvg(recordScene(s, 16), { title: 'a\fb' }),
      pdf: toPdfString(recordScene(s, 16), { title: 'a\fb' }),
    }
    for (const [name, text] of Object.entries(outs)) {
      expect({ name, controls: controls(text) }).toEqual({ name, controls: [] })
    }
  })
})

// ---------------------------------------------------------------------------
// 2. pgfplots and the unit circle / related rates
// ---------------------------------------------------------------------------

describe('2. pgfplots does not silently drop the unit circle or related rates', () => {
  it('a board with only a unit circle exports its circle, radius and point', () => {
    const f = unitCircleFigure(uc({ theta: Math.PI / 6 }))
    const tex = toPgfplots(scene([], { unitCircles: [f] }))
    expect(tex).toContain('% unit circle')
    // The circle passes through centre + (1, 0) and centre + (0, 1).
    const cx = f.center.x
    const cy = f.center.y
    expect(tex).toContain(`(${cx + 1},${cy})`)
    expect(tex).toContain(`(${cx},${cy + 1})`)
    // P(π/6) as a mark.
    expect(tex).toMatch(/only marks[^\n]*\] coordinates \{\([-0-9.]+,0\.5\)\}/)
    expect(tex).toMatch(/% not exported: the unit circle's angle arc, triangle and guides \(use TikZ for this figure\)/)
    const body = tex.split('\\begin{axis}')[1]
    expect(body).toMatch(/\\draw\[/)
  })

  it('related rates are named in a not-exported note', () => {
    const tex = toPgfplots(
      scene([], { relatedRates: [{ id: 'rr', visible: true, color: '#4f9cf9', prims: [], graph: null, title: null }] }),
    )
    expect(tex).toContain('% not exported: the related-rates scenario (use TikZ for this figure)')
  })
})

// ---------------------------------------------------------------------------
// 3. ✓ and ✗
// ---------------------------------------------------------------------------

describe('3. ✓ and ✗ are glyphs, not "?"', () => {
  it('TeX: \\surd and \\times — kernel symbols, no amssymb', () => {
    expect(texLabel('(1, 2) ✓')).toBe('$(1, 2) \\surd$')
    expect(texLabel('(1, 2) ✗')).toBe('$(1, 2) \\times$')
    expect(texLabel('is a solution ✓')).not.toContain('?')
    const tex = toPgfplots(kitchenSink(), { sources: { c1: 'y < x^2 - 4', c2: 'y >= 2x + 1' } })
    expect(tex).toContain('$(1, 2) \\surd$')
    expect(tex).not.toContain('amssymb')
    const tikz = toTikz(recordScene(kitchenSink(), 16))
    expect(tikz).toContain('$(1, 2) \\surd$')
    expect(tikz).toContain('$(0, 0) \\times$')
  })

  it('PDF: from ZapfDingbats (a19 = 0x33, a23 = 0x37), declared without WinAnsi', () => {
    const f = { family: 'x', generic: 'sans-serif' as const, size: 10, italic: false, bold: false }
    const runs = pdfTextRuns('(1, 2) ✓ ✗', f)
    expect(runs.some((r) => r.font === 'ZapfDingbats' && r.codes.includes(0x33))).toBe(true)
    expect(runs.some((r) => r.font === 'ZapfDingbats' && r.codes.includes(0x37))).toBe(true)
    expect(runs.flatMap((r) => r.codes)).not.toContain(63)
    const pdf = toPdfString(recordScene(kitchenSink(), 16))
    expect(pdf).toContain('<< /Type /Font /Subtype /Type1 /BaseFont /ZapfDingbats >>')
  })
})

// ---------------------------------------------------------------------------
// 4. Prose punctuation inside mathematics
// ---------------------------------------------------------------------------

describe('4. texMath never writes "?"', () => {
  it('curly quotes, dashes and ellipsis inside maths go to \\mbox text', () => {
    const m = texMath('f‘(x) — y’ “a” … x')
    expect(m).not.toContain('?')
    expect(m).toContain('\\mbox{`}')
    expect(m).toContain("\\mbox{'}")
    expect(m).toContain('\\mbox{``}')
    expect(m).toContain("\\mbox{''}")
    expect(m).toContain('\\mbox{---}')
    expect(m).toContain('\\ldots')
  })

  it('labels with non-ASCII text never contain "?" or a raw non-ASCII byte', () => {
    for (const s of ['x = 2 — “the” root', 'Gökhan’s ğraph ş İ ı', 'x ∈ ℕ, ζ(2) ≅ π²/6', 'snow ☃ x = 1', 'ﬁt: y = 2x']) {
      const t = texLabel(s)
      expect({ s, t, q: t.includes('?') }).toEqual({ s, t, q: false })
      // eslint-disable-next-line no-control-regex
      expect([...t].every((c) => c.charCodeAt(0) <= 126 || /[À-ÖØ-öø-ÿ]/.test(c))).toBe(true)
    }
    expect(texLabel('ğraph şekil')).toBe('\\u{g}raph \\c{s}ekil')
    expect(texLabel('x = ğ')).toBe('$x = \\mbox{\\u{g}}$')
    expect(texLabel('ılık')).toBe('{\\i}l{\\i}k')
    expect(texLabel('İzmir')).toBe('\\.{I}zmir')
    expect(texLabel('snow ☃')).toContain('[U+2603]')
  })

  it('math text uses \\mbox, never amsmath\'s \\text', () => {
    expect(texMath('x = é')).toBe('x = \\mbox{é}')
  })
})

// ---------------------------------------------------------------------------
// 5. TikZ dimensions
// ---------------------------------------------------------------------------

function maxCoordPt(tikz: string): number {
  let m = 0
  for (const match of tikz.matchAll(/\((-?[0-9.]+),(-?[0-9.]+)\)/g)) {
    m = Math.max(m, Math.abs(Number(match[1])), Math.abs(Number(match[2])))
  }
  for (const match of tikz.matchAll(/radius=(-?[0-9.]+)/g)) m = Math.max(m, Math.abs(Number(match[1])))
  return m
}

describe('5. no TikZ coordinate past 16,000 pt', () => {
  it('the tan⁻¹(1000) guide is cut to the view', () => {
    const f = unitCircleFigure(uc({ inv: { fn: 'tan', v: 1000 } }))
    const s: BoardScene = {
      vp: { center: { x: 1, y: 0 }, pxPerUnit: 90, widthPx: 1000, heightPx: 500 },
      theme: DARK_THEME,
      curves: [],
      styles: {},
      models: MODELS,
      analysis: null,
      chrome: null,
      unitCircles: [f],
    }
    const tikz = toTikz(recordScene(s, 16))
    expect(maxCoordPt(tikz)).toBeLessThanOrEqual(TIKZ_MAX_PT)
    // …and in the display list itself, the guide stays near the view.
    const list = recordScene(s, 16)
    for (const it of list.items) {
      if (it.t !== 'path') continue
      for (const g of it.segs) if (g.k === 'L' || g.k === 'M') expect(Math.abs(g.y)).toBeLessThan(10 * list.height)
    }
  })

  it('the safety net: any far-off line, polygon or label is kept inside', () => {
    const list = recordDrawing(400, 300, (ctx) => {
      ctx.strokeStyle = '#000'
      ctx.setLineDash([4, 2])
      ctx.beginPath()
      ctx.moveTo(-1e6, -3e5)
      ctx.lineTo(1e6, 3e5)
      ctx.stroke()
      ctx.fillStyle = '#f00'
      ctx.beginPath()
      ctx.moveTo(200, 150)
      ctx.lineTo(9e5, 150)
      ctx.lineTo(9e5, 9e5)
      ctx.closePath()
      ctx.fill()
      ctx.beginPath()
      ctx.arc(1e6, 1e6, 5e5, 0, Math.PI)
      ctx.stroke()
      ctx.font = '12px sans-serif'
      ctx.fillText('far', 5e5, 5e5)
      ctx.fillText('near', 10, 20)
    })
    const tikz = toTikz(list)
    expect(maxCoordPt(tikz)).toBeLessThanOrEqual(TIKZ_MAX_PT)
    expect(tikz).toContain('{near}')
    expect(tikz).not.toContain('{far}')
    expect(tikz).toContain('\\useasboundingbox (0,0) rectangle (300,225);')
    // The line still crosses the page through its centre (200, 150) px → (150, 112.5) pt.
    expect(tikz).toMatch(/\\draw\[[^\]]*dash pattern[^\]]*\] \(-?[0-9.]+,-?[0-9.]+\) -- \(-?[0-9.]+,-?[0-9.]+\);/)
  })

  it('a path already inside the box is left exactly as it was', () => {
    const segs = [
      { k: 'M' as const, x: 1, y: 2 },
      { k: 'L' as const, x: 3, y: 4 },
    ]
    expect(fitSegs(segs, { x0: 0, y0: 0, x1: 10, y1: 10 }, false)).toBe(segs)
  })
})

// ---------------------------------------------------------------------------
// 6. Inequality shading across a pan
// ---------------------------------------------------------------------------

describe('6. a pan inside the pad reuses the cached shading', () => {
  const { curves, models } = boardOf(['sin(x^2 + y^2) > 0'])
  const info = inequalityOf(curves[0], models)!

  it('same polygons while the view stays inside the padded box; new ones past it or on zoom', () => {
    clearInequalityCache()
    const vp0 = { center: { x: 0, y: 0 }, pxPerUnit: 40, widthPx: 600, heightPx: 400 }
    const a = regionOnView(info.parts, vp0)
    expect(a.length).toBeGreaterThan(0)
    // 20 % of the view to the right and 15 % up: inside the 1.5× pad.
    const panned = { ...vp0, center: { x: (0.2 * 600) / 40, y: (0.15 * 400) / 40 } }
    expect(regionOnView(info.parts, panned)).toBe(a)
    // A whole view away: recomputed.
    const far = { ...vp0, center: { x: 600 / 40, y: 0 } }
    const b = regionOnView(info.parts, far)
    expect(b).not.toBe(a)
    // A zoom: recomputed.
    expect(regionOnView(info.parts, { ...far, pxPerUnit: 50 })).not.toBe(b)
  })

  it('panning frame by frame inside the pad costs a lookup, not a re-shade', () => {
    clearInequalityCache()
    const frame = (dx: number): void => {
      const ctx = new MockCtx()
      const s: BoardScene = {
        vp: { center: { x: dx, y: 0 }, pxPerUnit: 40, widthPx: 600, heightPx: 400 },
        theme: DARK_THEME,
        curves,
        styles: {},
        models,
        analysis: null,
        chrome: null,
      }
      withMockPath2D(() => renderBoard(ctx as unknown as CanvasRenderingContext2D, s))
    }
    const t0 = performance.now()
    frame(0)
    const first = performance.now() - t0
    const t1 = performance.now()
    for (let i = 1; i <= 10; i++) frame(i * 0.2) // 10 frames, 8 px each: 80 px < the 150 px pad
    const rest = (performance.now() - t1) / 10
    // Each later frame is much cheaper than the one that shaded (the boundary
    // contour is cached the same way). Generous, to stay robust on slow CI.
    expect(rest).toBeLessThan(Math.max(first * 0.5, 5))
  })
})

// ---------------------------------------------------------------------------
// 7. Long captions
// ---------------------------------------------------------------------------

describe('7. a long caption wraps inside the plot', () => {
  const LONG =
    'Figure 3. The region where both y < x² − 4 and y ≥ 2x + 1 hold, shaded darker, with the test point (1, 2) and the corner points of the feasible region marked and labelled'

  it('the layout keeps to at most three lines, each inside the plot width', () => {
    const lay = captionLayout(LONG, 600, 1)
    expect(lay.lines.length).toBeGreaterThanOrEqual(2)
    expect(lay.lines.length).toBeLessThanOrEqual(CAPTION_MAX_LINES)
    expect(lay.lines.join(' ').replace(/…$/, '')).toBe(LONG.slice(0, lay.lines.join(' ').replace(/…$/, '').length))
    // A caption that fits stays one line, and its band is the old one.
    expect(captionLayout('Graph of f', 600, 1).lines).toEqual(['Graph of f'])
    expect(captionHeight(null, 'Graph of f', 600)).toBe(captionHeight())
    expect(captionHeight(null, LONG, 600)).toBeGreaterThan(captionHeight())
  })

  it('every caption line in the export sits inside the plot, stacked in the reserved band', () => {
    const s = scene(['y = x^2 - 4'], { caption: LONG })
    const m = 16
    const list = recordScene(s, m)
    const words = new Set(LONG.split(' '))
    const lines = list.items.filter(
      (i): i is TextItem => i.t === 'text' && i.text.split(' ').filter((w) => words.has(w)).length >= 3,
    )
    expect(lines.length).toBeGreaterThanOrEqual(2)
    expect(lines.length).toBeLessThanOrEqual(CAPTION_MAX_LINES)
    for (const l of lines) {
      expect(l.x - l.width / 2).toBeGreaterThanOrEqual(m + CAPTION_SIDE - 1)
      expect(l.x + l.width / 2).toBeLessThanOrEqual(m + VP.widthPx - CAPTION_SIDE + 1)
    }
    // Top line's cap height stays inside the band the grid keeps clear.
    const band = captionHeight(null, LONG, VP.widthPx)
    const top = Math.min(...lines.map((l) => l.y))
    expect(top - 14).toBeGreaterThanOrEqual(m + VP.heightPx - band - 1)
    // The same wrap reaches the TikZ and pgfplots exports' geometry.
    const tikz = toTikz(list)
    expect(tikz.match(/\\node\[/g)?.length ?? 0).toBeGreaterThan(0)
    const pg = toPgfplots(s)
    expect(pg).toContain(`height=${((VP.heightPx - band) / (96 / 2.54)).toFixed(2).replace(/\.?0+$/, '')}cm`)
  })
})

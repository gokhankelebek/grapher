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
import {
  renderBoard,
  type BoardChrome,
  type BoardScene,
  type Polyline,
  type Shape,
  type SlopeField,
} from '../src/ui/renderBoard'
import { MockCtx, MockPath2D, withMockPath2D } from './mockCanvas'
import { MODELS } from '../src/core/fit/models'
import { analyzeCurve } from '../src/core/analyze'
import { getHandles } from '../src/core/fit/edit'
import { DARK_THEME, LIGHT_THEME, CURVE_COLORS, PRINT_CURVE_COLORS } from '../src/core/types'
import type { FittedCurve, SpecialPoint, Viewport } from '../src/core/types'

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

// ===========================================================================
// The canvas audit. Five reviewers, and every claim below is one of theirs,
// re-measured against what the renderer actually emits.
// ===========================================================================

/** MockCtx plus the three things these assertions need: the font a label was
 *  drawn in, the width a stroke was drawn at, and where the arcs landed. */
class RichCtx extends MockCtx {
  fonts: Array<{ text: string; x: number; y: number; font: string }> = []
  strokes: Array<{ lw: number; alpha: number; path: boolean }> = []
  arcs: Array<{ x: number; y: number; r: number }> = []

  fillText(text: string, x: number, y: number): void {
    this.fonts.push({ text, x, y, font: this.font })
    super.fillText(text, x, y)
  }
  arc(x: number, y: number, r: number): void {
    this.arcs.push({ x, y, r })
    super.arc(x, y, r)
  }
  stroke(path?: MockPath2D): void {
    this.strokes.push({ lw: this.lineWidth, alpha: this.globalAlpha, path: !!path })
    super.stroke(path)
  }
}

function richRender(s: BoardScene): RichCtx {
  const ctx = new RichCtx()
  withMockPath2D(() => renderBoard(ctx as unknown as CanvasRenderingContext2D, s))
  return ctx
}

/** y = 0.3(x-3)^2 - 2 — the reviewer's own case. poly2 params are ascending. */
const PARABOLA: FittedCurve = {
  id: 'p1', modelId: 'poly2', params: [0.7, -1.8, 0.3],
  kind: 'explicit', domain: null,
  color: CURVE_COLORS[0], strokeWidth: 2.5, visible: true, error: 0,
}
const VERTEX_LABEL = '(3.000, \u22122.000)'
const Y_INTERCEPT_LABEL = '(0, 0.7000)'

/** Chrome for the parabola fixture — chromeOn() selects the cubic. */
const parabolaChrome = (over: Partial<BoardChrome> = {}): BoardChrome => ({
  selectedId: PARABOLA.id,
  handles: getHandles(PARABOLA, MODELS),
  activeHandleId: null, highlight: null, openIdx: null, hoverIdx: null,
  ...over,
})

function parabola(over: Partial<BoardScene> = {}): BoardScene {
  return {
    vp: VP, theme: DARK_THEME, curves: [PARABOLA], styles: {}, models: MODELS,
    analysis: { curve: PARABOLA, points: analyzeCurve(PARABOLA, MODELS) },
    chrome: null,
    ...over,
  }
}

/**
 * The analysis labels, and only those: they are the mono-font text on the
 * board, where the grid's tick numbers are system-ui.
 */
function coordLabels(ctx: RichCtx): string[] {
  return ctx.fonts.filter((f) => f.font.includes('Mono')).map((f) => f.text)
}

function relLum(hex: string): number {
  const v = parseInt(hex.slice(1), 16)
  const ch = (c: number): number => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * ch((v >> 16) & 255) + 0.7152 * ch((v >> 8) & 255) + 0.0722 * ch(v & 255)
}

function contrast(a: string, b: string): number {
  const la = relLum(a)
  const lb = relLum(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

// ---------------------------------------------------------------------------
// 1. The light canvas washed the curves out, and did not match its own export.
// ---------------------------------------------------------------------------

describe('renderBoard — the palette follows the ground, not the export flag', () => {
  it('a LIVE light-theme board (no printColors flag) already uses print colours', () => {
    const live = richRender(parabola({ theme: LIGHT_THEME, chrome: parabolaChrome() }))
    expect(live.strokeStyles, 'the live light board still drew the dark-tuned palette')
      .toContain(PRINT_CURVE_COLORS[0])
    expect(live.strokeStyles).not.toContain(CURVE_COLORS[0])
  })

  it('screen and export agree on a light ground — the preview is the file', () => {
    const screen = richRender(parabola({ theme: LIGHT_THEME, chrome: parabolaChrome() }))
    const file = richRender(parabola({ theme: LIGHT_THEME, printColors: true, chrome: null }))
    const curveInk = (c: MockCtx): string[] =>
      c.strokeStyles.filter((s) => CURVE_COLORS.includes(s) || PRINT_CURVE_COLORS.includes(s))
    expect(new Set(curveInk(screen))).toEqual(new Set(curveInk(file)))
  })

  it('every curve colour the light board paints clears 4.5:1 on its own ground', () => {
    const live = richRender(parabola({ theme: LIGHT_THEME, chrome: parabolaChrome() }))
    const ink = live.strokeStyles.filter(
      (s) => CURVE_COLORS.includes(s) || PRINT_CURVE_COLORS.includes(s),
    )
    expect(ink.length).toBeGreaterThan(0)
    for (const c of ink) {
      // the screen palette measured 1.51-3.07:1 here; the print palette 4.9-7.3
      expect(contrast(c, LIGHT_THEME.bg), `${c} on white`).toBeGreaterThan(4.5)
    }
  })

  it('a dark board is untouched: it keeps the screen palette', () => {
    const dark = richRender(parabola({ theme: DARK_THEME, chrome: parabolaChrome() }))
    expect(dark.strokeStyles).toContain(CURVE_COLORS[0])
    expect(dark.strokeStyles).not.toContain(PRINT_CURVE_COLORS[0])
  })

  it('the selection halo is drawn with real weight on white, not a 25% ghost', () => {
    const sel = (theme: typeof DARK_THEME): number => {
      const ctx = richRender(parabola({ theme, chrome: parabolaChrome() }))
      // the halo is the only stroke of a Path2D drawn at partial alpha
      const halo = ctx.strokes.filter((s) => s.path && s.alpha < 1)
      expect(halo.length, 'the selected curve drew no halo at all').toBeGreaterThan(0)
      return halo[0].alpha
    }
    const onWhite = sel(LIGHT_THEME)
    const onBlack = sel(DARK_THEME)
    expect(onWhite).toBeGreaterThan(onBlack)
    // composited over the ground, the wash has to be something a projector shows
    const wash = (hex: string, bg: string, a: number): string => {
      const f = parseInt(hex.slice(1), 16)
      const b = parseInt(bg.slice(1), 16)
      const mix = (sh: number): number =>
        Math.round((((f >> sh) & 255) * a + ((b >> sh) & 255) * (1 - a)))
      return `#${[16, 8, 0].map((sh) => mix(sh).toString(16).padStart(2, '0')).join('')}`
    }
    expect(contrast(wash(PRINT_CURVE_COLORS[0], '#ffffff', onWhite), '#ffffff')).toBeGreaterThan(1.9)
  })
})

// ---------------------------------------------------------------------------
// 3. The vertex is the number the class wants.
// ---------------------------------------------------------------------------

describe('drawAnalysis — label priority', () => {
  it('spends a single-label budget on the minimum, not on the y-intercept', () => {
    // At 6 px/unit every feature of this parabola is inside one MIN_LABEL_GAP,
    // so exactly one label fits. It used to be the leftmost point — the
    // y-intercept — sitting between two features and reading as the vertex.
    const tight = { ...VP, pxPerUnit: 6 }
    const ctx = richRender(parabola({ vp: tight }))
    const labels = coordLabels(ctx)
    expect(labels).toContain(VERTEX_LABEL)
    expect(labels, 'the y-intercept took the budget again').not.toContain(Y_INTERCEPT_LABEL)
    expect(labels).toHaveLength(1)
  })

  it('with room for some but not all, extrema and zeros beat the y-intercept', () => {
    // 20 px/unit: the vertex and both zeros clear the gap, the y-intercept
    // (8px from the first zero) does not — and it is the one that gives way.
    const ctx = richRender(parabola({ vp: { ...VP, pxPerUnit: 20 } }))
    const labels = coordLabels(ctx)
    expect(labels).toContain(VERTEX_LABEL)
    expect(labels).not.toContain(Y_INTERCEPT_LABEL)
    expect(labels.length).toBe(3) // vertex + two zeros
  })

  it('given room for everything, the y-intercept is still labelled', () => {
    const labels = coordLabels(richRender(parabola({ vp: { ...VP, pxPerUnit: 120 } })))
    expect(labels).toContain(VERTEX_LABEL)
    expect(labels).toContain(Y_INTERCEPT_LABEL)
  })

  it('the vertex is labelled even when its own handle masks the marker', () => {
    // The handle sits exactly on the minimum, so the marker glyph yields to it.
    // The coordinates must not yield with it — that is how the one number the
    // class is after ended up being the only feature never labelled.
    const ctx = richRender(parabola({ chrome: parabolaChrome() }))
    const handles = getHandles(PARABOLA, MODELS)
    expect(
      handles.some((h) => h.pos.x === 3 && h.pos.y === -2),
      'fixture must have a handle on the vertex',
    ).toBe(true)
    expect(coordLabels(ctx)).toContain(VERTEX_LABEL)
    // ...and the marker glyph really did yield: no extremum dot under the handle
    const vx = VP.widthPx / 2 + 3 * VP.pxPerUnit
    const vy = VP.heightPx / 2 + 2 * VP.pxPerUnit
    const at = ctx.arcs.filter((a) => Math.hypot(a.x - vx, a.y - vy) <= 1)
    expect(at, 'marker and handle were both drawn on the same spot').toHaveLength(2)
  })

  it('a hovered point keeps its label whatever its kind', () => {
    const ctx = richRender(
      parabola({
        vp: { ...VP, pxPerUnit: 6 },
        chrome: parabolaChrome({ selectedId: null, handles: [], highlight: 0 }),
      }),
    )
    expect(coordLabels(ctx)).toContain(Y_INTERCEPT_LABEL) // index 0 is the y-intercept
  })
})

// ---------------------------------------------------------------------------
// 3b. A label must not sit ON the curve it is labelling.
// ---------------------------------------------------------------------------

describe('drawAnalysis — labels step off the curve', () => {
  /** The plate the renderer drew for `text`, in screen px. */
  function plateOf(ctx: RichCtx, text: string, type = 1): { x: number; y: number; w: number; h: number } {
    const t = ctx.fonts.find((f) => f.text === text)
    expect(t, `no label "${text}" was drawn`).toBeTruthy()
    const w = text.length * 6 + 10 * type // mockCanvas measureText + padding
    const h = 16 * type
    return { x: t!.x - 5 * type, y: t!.y - h / 2, w, h }
  }

  it('the vertex label box contains no point of the parabola', () => {
    const ctx = richRender(parabola())
    const box = plateOf(ctx, VERTEX_LABEL)
    const f = (x: number): number => MODELS.poly2.evalExplicit!(PARABOLA.params, x)
    const sx = (x: number): number => VP.widthPx / 2 + (x - VP.center.x) * VP.pxPerUnit
    const sy = (y: number): number => VP.heightPx / 2 - (y - VP.center.y) * VP.pxPerUnit
    let inside = 0
    for (let px = box.x - 2; px <= box.x + box.w + 2; px += 0.5) {
      const x = VP.center.x + (px - VP.widthPx / 2) / VP.pxPerUnit
      const py = sy(f(x))
      if (py >= box.y - 1 && py <= box.y + box.h + 1) inside++
    }
    expect(inside, 'the label plate was placed on top of the curve').toBe(0)
    // and it really is the vertex's label: a leader runs from the marker to it
    const vx = sx(3)
    const vy = sy(-2)
    const leader = ctx.own.subpaths().some(
      (sp) =>
        sp.length === 2 &&
        Math.hypot(sp[0].x - vx, sp[0].y - vy) < 0.5 &&
        Math.abs(sp[1].x - (box.x + box.w / 2)) < 0.5 &&
        Math.abs(sp[1].y - (box.y + box.h / 2)) < 0.5,
    )
    expect(leader, 'the label has no leader back to its marker').toBe(true)
  })

  it('NO analysis label plate sits on its own curve — parabola and cubic, any zoom', () => {
    const cases: Array<{ curve: FittedCurve; ppu: number }> = [
      { curve: PARABOLA, ppu: 120 }, { curve: PARABOLA, ppu: 60 }, { curve: PARABOLA, ppu: 30 },
      { curve: CUBIC, ppu: 120 }, { curve: CUBIC, ppu: 60 }, { curve: CUBIC, ppu: 40 },
    ]
    for (const { curve, ppu } of cases) {
      const vp = { ...VP, pxPerUnit: ppu }
      const ctx = richRender({
        vp, theme: DARK_THEME, curves: [curve], styles: {}, models: MODELS,
        analysis: { curve, points: analyzeCurve(curve, MODELS) },
        chrome: null,
      })
      const f = (x: number): number =>
        MODELS[curve.modelId].evalExplicit!(curve.params, x)
      const plates = ctx.fonts.filter((t) => t.font.includes('Mono'))
      expect(plates.length, `${curve.modelId} @${ppu} drew no labels at all`)
        .toBeGreaterThan(0)
      for (const t of plates) {
        const box = { x: t.x - 5, y: t.y - 8, w: t.text.length * 6 + 10, h: 16 }
        for (let px = box.x; px <= box.x + box.w; px += 0.5) {
          const x = vp.center.x + (px - vp.widthPx / 2) / ppu
          if (curve.domain && (x < curve.domain[0] || x > curve.domain[1])) continue
          const py = vp.heightPx / 2 - (f(x) - vp.center.y) * ppu
          const hit = py >= box.y && py <= box.y + box.h
          expect(hit, `${curve.modelId} @${ppu}: "${t.text}" sits on the curve`).toBe(false)
        }
      }
    }
  })

  it('a minimum labels below itself and a maximum above — away from the arms', () => {
    const ctx = richRender(parabola())
    const t = ctx.fonts.find((f) => f.text === VERTEX_LABEL)!
    const vy = VP.heightPx / 2 + 2 * VP.pxPerUnit // screen y of (3, -2)
    expect(t.y, 'the minimum labelled itself inside its own U').toBeGreaterThan(vy)
  })
})

// ---------------------------------------------------------------------------
// 4. Handles and markers are different vocabularies.
// ---------------------------------------------------------------------------

describe('handles vs markers — one glyph, one meaning', () => {
  const TRIMMED: FittedCurve = { ...PARABOLA, domain: [-1, 5] }
  const trimmedScene = (over: Partial<BoardScene> = {}): BoardScene => ({
    ...parabola(),
    curves: [TRIMMED],
    analysis: { curve: TRIMMED, points: analyzeCurve(TRIMMED, MODELS) },
    chrome: {
      selectedId: TRIMMED.id,
      handles: getHandles(TRIMMED, MODELS),
      activeHandleId: null, highlight: null, openIdx: null, hoverIdx: null,
    },
    ...over,
  })
  const sx = (x: number): number => VP.widthPx / 2 + x * VP.pxPerUnit
  const sy = (y: number): number => VP.heightPx / 2 - y * VP.pxPerUnit

  it('a domain trim end is NOT a circle — the zero marker owns that glyph', () => {
    const ctx = richRender(trimmedScene())
    const handles = getHandles(TRIMMED, MODELS)
    const ends = handles.filter((h) => h.kind === 'domain-start' || h.kind === 'domain-end')
    expect(ends.length, 'fixture must have trim handles').toBe(2)
    for (const h of ends) {
      const hx = sx(h.pos.x)
      const hy = sy(h.pos.y)
      const circles = ctx.arcs.filter((a) => Math.hypot(a.x - hx, a.y - hy) <= 9)
      expect(circles, `${h.id} was drawn as a circle again`).toHaveLength(0)
    }
  })

  it('a trim end is a bracket, facing into the domain', () => {
    const ctx = richRender(trimmedScene())
    const hx = sx(5)
    const hy = sy(-0.8)
    // ] = arm, corner, corner, arm — the arms turn back toward the domain
    const bracket = ctx.own.subpaths().some(
      (sp) =>
        sp.length === 4 &&
        Math.abs(sp[1].x - hx) < 0.5 &&
        Math.abs(sp[2].x - hx) < 0.5 &&
        sp[0].x < hx - 2 && sp[3].x < hx - 2 &&
        Math.abs(sp[0].y - sp[1].y) < 0.5 &&
        sp[0].y < hy && sp[3].y > hy,
    )
    expect(bracket, 'the trim end did not draw a bracket').toBe(true)
  })

  it('a zero marker keeps its hollow ring, so the two never collide', () => {
    const ctx = richRender(trimmedScene())
    const zeroX = sx(0.41801110252838874)
    const ring = ctx.arcs.filter((a) => Math.hypot(a.x - zeroX, a.y - sy(0)) <= 2)
    expect(ring.length, 'the zero lost its ring').toBeGreaterThan(0)
    expect(ring[0].r).toBeCloseTo(4, 5)
  })

  it('a grab handle is a cored dot — two arcs, not one', () => {
    const ctx = richRender(trimmedScene())
    const vx = sx(3)
    const vy = sy(-2)
    const at = ctx.arcs.filter((a) => Math.hypot(a.x - vx, a.y - vy) <= 1)
    expect(at.length, 'the vertex handle is still a plain dot').toBe(2)
    const radii = at.map((a) => a.r).sort((a, b) => a - b)
    expect(radii[0]).toBeLessThan(radii[1] * 0.6) // an inner core ring
  })

  it('the active handle still reads as active', () => {
    const idle = richRender(trimmedScene())
    const active = richRender(
      trimmedScene({
        chrome: { ...(trimmedScene().chrome as BoardChrome), activeHandleId: 'vertex' },
      }),
    )
    const rOf = (c: RichCtx): number =>
      Math.max(...c.arcs.filter((a) => Math.hypot(a.x - sx(3), a.y - sy(-2)) <= 1).map((a) => a.r))
    expect(rOf(active)).toBeGreaterThan(rOf(idle))
  })
})

// ---------------------------------------------------------------------------
// 5. Presentation scaling.
// ---------------------------------------------------------------------------

describe('BoardScene.present — the board a class can read from the back', () => {
  const px = (font: string): number => Number(/^([\d.]+)px/.exec(font)?.[1] ?? 0)

  it('multiplies every on-canvas font by present.type', () => {
    const one = richRender(parabola())
    const two = richRender(parabola({ present: { type: 2, stroke: 1 } }))
    const sizes = (c: RichCtx): number[] => [...new Set(c.fonts.map((f) => px(f.font)))].sort()
    expect(sizes(one)).toEqual([11])
    expect(sizes(two)).toEqual([22])
  })

  it('multiplies the curve stroke by present.stroke', () => {
    const widthOf = (c: RichCtx): number =>
      Math.max(...c.strokes.filter((s) => s.path && s.alpha === 1).map((s) => s.lw))
    expect(widthOf(richRender(parabola()))).toBeCloseTo(2.5, 6)
    expect(widthOf(richRender(parabola({ present: { type: 1, stroke: 2 } })))).toBeCloseTo(5, 6)
  })

  it('scales the marker glyphs, so the collision budget is spent on real sizes', () => {
    const rings = (c: RichCtx): number[] =>
      c.arcs.filter((a) => Math.abs(a.y - VP.heightPx / 2) < 0.5).map((a) => a.r)
    const one = Math.max(...rings(richRender(parabola())))
    const two = Math.max(...rings(richRender(parabola({ present: { type: 1, stroke: 2 } }))))
    expect(two).toBeCloseTo(one * 2, 6)
  })

  it('label crowding is judged at the scaled size, not the 11px one', () => {
    const mid = { ...VP, pxPerUnit: 20 }
    const small = coordLabels(richRender(parabola({ vp: mid })))
    const big = coordLabels(richRender(parabola({ vp: mid, present: { type: 2, stroke: 2 } })))
    expect(small.length).toBeGreaterThan(big.length)
    // whatever is dropped, the vertex is never the thing that goes
    expect(small).toContain(VERTEX_LABEL)
    expect(big).toContain(VERTEX_LABEL)
  })

  it('an absent or nonsense present scale draws exactly the unscaled board', () => {
    const base = richRender(parabola())
    for (const bad of [
      { type: NaN, stroke: NaN },
      { type: 0, stroke: -3 },
    ]) {
      const ctx = richRender(parabola({ present: bad }))
      expect(ctx.fonts.map((f) => f.font)).toEqual(base.fonts.map((f) => f.font))
      expect(ctx.texts.map((t) => t.text)).toEqual(base.texts.map((t) => t.text))
    }
  })
})

// ===========================================================================
// The overlay layer (shaded area / Riemann rectangles / closed region) paints
// between the grid and the curves. Every assertion ABOVE this line was written
// before it existed, and must keep measuring the same board — so the guard is
// not "the suite still passes" but the stronger claim that a scene with an
// EMPTY overlay list emits a byte-identical command stream. The overlays'
// own behaviour is pinned in tests/overlays.test.ts.
// ===========================================================================

describe('renderBoard — overlays absent change nothing', () => {
  const stream = (ctx: MockCtx): string =>
    JSON.stringify({
      cmds: ctx.own.cmds,
      texts: ctx.texts,
      fills: ctx.fills,
      strokeStyles: ctx.strokeStyles,
      fillStyles: ctx.fillStyles,
      counts: [ctx.strokeCount, ctx.fillCount, ctx.textCount,
               ctx.saveCount, ctx.restoreCount, ctx.arcCount],
      paths: ctx.strokedPaths.map((p) => p.cmds),
    })

  it('`overlays: []` is byte-identical to no overlays field, figure and screen', () => {
    for (const chrome of [null, chromeOn()]) {
      const before = render(scene({ chrome }))
      const after = render(scene({ chrome, overlays: [] }))
      expect(stream(after)).toBe(stream(before))
    }
  })

  it('an overlay that IS present reaches the figure (chrome:null)', () => {
    const shaded = render(scene({
      chrome: null,
      overlays: [{ kind: 'area', curveId: CUBIC.id, from: -2, to: 1 }],
    }))
    const plain = render(scene({ chrome: null }))
    expect(shaded.fillCount, 'the shaded area never reached the export')
      .toBeGreaterThan(plain.fillCount)
  })
})

// ===========================================================================
// Slope fields and solution curves.
//
// Same claim as the overlays above, one layer further down: a board that
// never mentions `fields`/`polylines` must emit the byte-identical command
// stream it emitted before the layer existed, and a field that IS present
// must reach the export. The layer's own behaviour is pinned in
// tests/fields.test.ts.
// ===========================================================================

describe('renderBoard — slope fields absent change nothing', () => {
  const stream = (ctx: MockCtx): string =>
    JSON.stringify({
      cmds: ctx.own.cmds,
      texts: ctx.texts,
      fills: ctx.fills,
      strokeStyles: ctx.strokeStyles,
      fillStyles: ctx.fillStyles,
      counts: [ctx.strokeCount, ctx.fillCount, ctx.textCount,
               ctx.saveCount, ctx.restoreCount, ctx.arcCount],
      paths: ctx.strokedPaths.map((p) => p.cmds),
    })

  const FIELD: SlopeField = {
    id: 'sf', f: (x, y) => x - y, latex: 'dy/dx = x - y',
    color: CURVE_COLORS[1], visible: true,
  }
  const SOLUTION: Polyline = {
    id: 'sol',
    pts: [{ x: -2, y: 1 }, { x: -1, y: 0.2 }, { x: 0, y: 0 }, { x: 1, y: 0.37 }],
    color: CURVE_COLORS[2],
  }

  it('`fields: []` / `polylines: []` are byte-identical to the fields absent', () => {
    for (const chrome of [null, chromeOn()]) {
      const before = render(scene({ chrome }))
      const after = render(scene({ chrome, fields: [], polylines: [] }))
      expect(stream(after)).toBe(stream(before))
    }
  })

  it('a field and its solution curve reach the figure (chrome:null)', () => {
    const plain = render(scene({ chrome: null }))
    const withField = render(scene({ chrome: null, fields: [FIELD], polylines: [SOLUTION] }))
    expect(withField.strokeCount, 'the field never reached the export')
      .toBeGreaterThan(plain.strokeCount)
    expect(withField.strokeStyles).toContain(CURVE_COLORS[1])
    expect(withField.strokeStyles).toContain(CURVE_COLORS[2])
  })

  it('both map to the print palette on a light ground, like every stroke', () => {
    const ctx = render(scene({
      theme: LIGHT_THEME, chrome: null, fields: [FIELD], polylines: [SOLUTION],
    }))
    expect(ctx.strokeStyles).toContain(PRINT_CURVE_COLORS[1])
    expect(ctx.strokeStyles).toContain(PRINT_CURVE_COLORS[2])
    expect(ctx.strokeStyles).not.toContain(CURVE_COLORS[1])
  })
})

// ===========================================================================
// Shapes — points, segments, vectors and polygons.
//
// Same claim once more, one layer up: a board that never mentions `shapes`
// must emit the byte-identical command stream it emitted before the layer
// existed, and a shape that IS present must reach the export — ON TOP of the
// curves it is measured against. The layer's own geometry is pinned in
// tests/shapes.render.test.ts.
// ===========================================================================

describe('renderBoard — shapes absent change nothing', () => {
  const stream = (ctx: MockCtx): string =>
    JSON.stringify({
      cmds: ctx.own.cmds,
      texts: ctx.texts,
      fills: ctx.fills,
      strokeStyles: ctx.strokeStyles,
      fillStyles: ctx.fillStyles,
      counts: [ctx.strokeCount, ctx.fillCount, ctx.textCount,
               ctx.saveCount, ctx.restoreCount, ctx.arcCount],
      paths: ctx.strokedPaths.map((p) => p.cmds),
    })

  const FIGURE: Shape[] = [
    {
      kind: 'polygon', id: 'tri',
      pts: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }],
      color: CURVE_COLORS[3], visible: true, fill: true, labels: ['A', 'B', 'C'],
    },
    {
      kind: 'vector', id: 'v', tail: { x: 0, y: 0 }, v: { x: 4, y: 3 },
      color: CURVE_COLORS[4], visible: true, label: 'v',
    },
  ]

  it('`shapes: []` is byte-identical to the field being absent', () => {
    for (const chrome of [null, chromeOn()]) {
      const before = render(scene({ chrome }))
      const after = render(scene({ chrome, shapes: [] }))
      expect(stream(after)).toBe(stream(before))
    }
  })

  it('a triangle and a vector reach the figure (chrome:null)', () => {
    const plain = render(scene({ chrome: null }))
    const withShapes = render(scene({ chrome: null, shapes: FIGURE }))
    expect(withShapes.strokeCount, 'the figure never reached the export')
      .toBeGreaterThan(plain.strokeCount)
    expect(withShapes.strokeStyles).toContain(CURVE_COLORS[3])
    expect(withShapes.strokeStyles).toContain(CURVE_COLORS[4])
    expect(withShapes.texts.map((t) => t.text)).toEqual(
      expect.arrayContaining(['A', 'B', 'C', 'v']),
    )
  })

  it('they map to the print palette on a light ground, like every stroke', () => {
    const ctx = render(scene({ theme: LIGHT_THEME, chrome: null, shapes: FIGURE }))
    expect(ctx.strokeStyles).toContain(PRINT_CURVE_COLORS[3])
    expect(ctx.strokeStyles).not.toContain(CURVE_COLORS[3])
  })

  it('are drawn ON TOP of the curve they are measured against', () => {
    const ctx = render(scene({ chrome: null, shapes: FIGURE }))
    // strokeStyles records a style at the moment it is used, in order: the
    // curve's own colour must appear before the figure's.
    const curve = ctx.strokeStyles.indexOf(CURVE_COLORS[0])
    const shape = ctx.strokeStyles.indexOf(CURVE_COLORS[3])
    expect(curve, 'the curve was never stroked').toBeGreaterThanOrEqual(0)
    expect(shape, 'the figure was never stroked').toBeGreaterThanOrEqual(0)
    expect(curve, 'the figure went under the curve').toBeLessThan(shape)
  })
})

// ---------------------------------------------------------------------------
// Holes: the one analysis kind with no marker of its own.
//
// Its glyph — the open ring — is drawn with the CURVE, in every figure style,
// whether the analysis layer is on or not (src/render/holes.ts). The analysis
// layer therefore states the coordinates and draws nothing else: a filled disc
// on top of a ring would fill in the one mark whose whole meaning is that it
// is empty. Tested here against the REAL src/core/holes.ts, so this also pins
// that an empty hole list leaves the board exactly as it was.
// ---------------------------------------------------------------------------

describe('renderBoard — a hole states its coordinates and draws no marker', () => {
  const HOLE: SpecialPoint = {
    kind: 'hole', pos: { x: 1, y: -2.1 }, label: 'hole', exact: false,
  }
  const at = (points: SpecialPoint[]): MockCtx =>
    render(scene({ chrome: null, analysis: { curve: CUBIC, points } }))

  it('adds a label chip and not one more arc', () => {
    const none = at([])
    const one = at([HOLE])
    expect(one.textCount).toBeGreaterThan(none.textCount)
    expect(one.arcCount).toBe(none.arcCount)
  })

  it('leaves every other kind\u2019s markers exactly as they were', () => {
    const real = analyzeCurve(CUBIC, MODELS)
    expect(real.length, 'fixture must have markers to preserve').toBeGreaterThan(0)
    const plain = at(real.slice())
    const mixed = at([...real, HOLE])
    expect(mixed.arcCount).toBe(plain.arcCount)
    expect(mixed.textCount).toBeGreaterThanOrEqual(plain.textCount)
  })

  it('the curve loop leaves no dash behind for the next layer', () => {
    // drawAsymptotes runs inside that loop and sets a dash of its own; the
    // shapes, the analysis layer and the caption are all drawn after it.
    expect(render(scene({ chrome: null })).getLineDash()).toEqual([])
  })
})

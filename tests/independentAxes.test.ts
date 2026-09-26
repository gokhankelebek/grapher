// ============================================================================
// tests/independentAxes.test.ts — the App's half of independent x and y scales.
//
// The renderers are tested beside the renderer. What is tested HERE is how the
// VIEW moves (ui/viewScale.ts), what a document remembers about it, and every
// place the app turns a pointer into mathematics: snapping, hit radii, sketch
// strokes. The rule underneath all of it: a stretched board has no single
// pixels-per-unit, so a LENGTH is only meaningful on screen.
// ============================================================================

import { describe, expect, it } from 'vitest'
import type { FittedCurve, Vec2, Viewport } from '../src/core/types'
import { isStretched, ppuX, ppuY, toMath, toScreen } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { deserializeDoc, docFromBoard, serializeDoc } from '../src/core/persist'
import type { BoardInput, DocMeta } from '../src/core/persist'
import { processStroke } from '../src/core/stroke'
import {
  DATA_ASPECT_LIMIT,
  applyWindow,
  axesModeOf,
  axesModeRefused,
  axisBandAt,
  boxAspectExcess,
  dragStretchFactor,
  fitBox,
  fitData,
  formatWindowValue,
  makeIndependent,
  nearestOnPolyline,
  panBy,
  readWindow,
  rulingRefused,
  screenDist,
  setAxisScale,
  squareAxes,
  squareToContain,
  stretchAbout,
  zoomAbout,
  clampPpu,
  MIN_PPU,
  MAX_PPU,
} from '../src/ui/viewScale'
import { snapCoord, snapPlaced, snapStep } from '../src/ui/snap'
import { hitRadii, wheelStretchAxis, wheelStretchDelta } from '../src/ui/gestures'
import { sampleCurveScreen } from '../src/ui/sample'

function vp(over: Partial<Viewport> = {}): Viewport {
  return { center: { x: 0, y: 0 }, pxPerUnit: 60, widthPx: 800, heightPx: 600, ...over }
}

const close = (a: number, b: number, eps = 1e-9): boolean =>
  Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b))

// ---------------------------------------------------------------------------
// persistence
// ---------------------------------------------------------------------------

const META: DocMeta = { id: 'doc1', name: 'Census', createdAt: 1000, modifiedAt: 1000 }

function board(viewport: BoardInput['viewport']): BoardInput {
  return {
    curves: [],
    styles: {},
    candidates: new Map(),
    exprSources: {},
    viewport,
    selectedId: null,
    mode: 'draw',
  }
}

describe('a document remembers its axes', () => {
  it('an equal-axes board writes exactly the bytes it always did', () => {
    const json = serializeDoc(docFromBoard(META, board({ center: { x: 1, y: 2 }, pxPerUnit: 60 }), 2000))
    expect(json).toContain('"viewport":{"cx":1,"cy":2,"ppu":60}')
    expect(json).not.toContain('ppuY')
    // …and reading it and writing it again changes nothing.
    const res = deserializeDoc(json)
    expect(res.board!.viewport.pxPerUnitY).toBeUndefined()
    const again = serializeDoc(docFromBoard(res.meta!, board(res.board!.viewport), 2000))
    expect(again).toBe(json)
  })

  it('an old document with no ppuY opens on equal axes, with no complaint', () => {
    const json = serializeDoc(docFromBoard(META, board({ center: { x: 0, y: 0 }, pxPerUnit: 45 }), 2000))
    const res = deserializeDoc(json)
    expect(res.problems).toEqual([])
    expect(axesModeOf({ ...vp(), ...res.board!.viewport })).toBe('equal')
  })

  it('Independent axes round-trip as board.viewport.ppuY', () => {
    const view = { center: { x: 2005, y: 290 }, pxPerUnit: 18.5, pxPerUnitY: 3.25 }
    const json = serializeDoc(docFromBoard(META, board(view), 2000))
    expect(json).toContain('"viewport":{"cx":2005,"cy":290,"ppu":18.5,"ppuY":3.25}')
    const res = deserializeDoc(json)
    expect(res.problems).toEqual([])
    expect(res.board!.viewport).toEqual(view)
    expect(serializeDoc(docFromBoard(res.meta!, board(res.board!.viewport), 2000))).toBe(json)
  })

  it('Independent at an equal scale is still Independent after a reload', () => {
    const json = serializeDoc(
      docFromBoard(META, board({ center: { x: 0, y: 0 }, pxPerUnit: 60, pxPerUnitY: 60 }), 2000),
    )
    const res = deserializeDoc(json)
    expect(axesModeOf({ ...vp(), ...res.board!.viewport })).toBe('independent')
  })

  it('an unreadable y scale is reported, and the board opens equal', () => {
    const json = serializeDoc(docFromBoard(META, board({ center: { x: 0, y: 0 }, pxPerUnit: 60 }), 2000))
    const hurt = json.replace('"ppu":60', '"ppu":60,"ppuY":"tall"')
    const res = deserializeDoc(hurt)
    expect(res.board!.viewport.pxPerUnitY).toBeUndefined()
    expect(res.problems.some((p) => /y scale/.test(p))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// zoom, pan, stretch
// ---------------------------------------------------------------------------

describe('zoom scales both axes by the same factor', () => {
  it('keeps the ratio and the point under the cursor', () => {
    const v = vp({ center: { x: 2000, y: 300 }, pxPerUnit: 20, pxPerUnitY: 4 })
    const cursor = { x: 610, y: 140 }
    const before = toMath(cursor, v)
    zoomAbout(v, cursor, 1.5)
    expect(ppuX(v)).toBeCloseTo(30, 12)
    expect(ppuY(v)).toBeCloseTo(6, 12)
    const after = toMath(cursor, v)
    expect(close(after.x, before.x)).toBe(true)
    expect(close(after.y, before.y)).toBe(true)
  })

  it('leaves an equal board equal', () => {
    const v = vp()
    zoomAbout(v, { x: 100, y: 100 }, 0.5)
    expect(v.pxPerUnitY).toBeUndefined()
    expect(v.pxPerUnit).toBe(30)
  })

  it('clamps one factor for both axes, so the ratio survives the limits', () => {
    const v = vp({ pxPerUnit: MAX_PPU * 0.9, pxPerUnitY: MAX_PPU * 0.09 })
    zoomAbout(v, { x: 400, y: 300 }, 10)
    expect(ppuX(v) / ppuY(v)).toBeCloseTo(10, 9)
    expect(ppuX(v)).toBeLessThanOrEqual(MAX_PPU)
  })

  it('pans by pixels on each axis’ own scale', () => {
    const v = vp({ pxPerUnit: 20, pxPerUnitY: 2 })
    panBy(v, 40, -10)
    expect(v.center.x).toBeCloseTo(-2, 12)
    expect(v.center.y).toBeCloseTo(-5, 12)
  })
})

describe('a stretch changes ONE axis and keeps its anchor fixed', () => {
  it('⇧-wheel: x only, about the cursor', () => {
    const v = vp({ center: { x: 1, y: 2 } })
    const cursor = { x: 620, y: 111 }
    const before = toMath(cursor, v)
    stretchAbout(v, 'x', cursor, 1.4)
    expect(ppuX(v)).toBeCloseTo(84, 12)
    expect(ppuY(v)).toBe(60)
    expect(v.center.y).toBe(2)
    expect(close(toMath(cursor, v).x, before.x)).toBe(true)
    expect(axesModeOf(v)).toBe('independent')
  })

  it('⌥-wheel: y only, about the cursor', () => {
    const v = vp({ center: { x: 1, y: 2 } })
    const cursor = { x: 620, y: 111 }
    const before = toMath(cursor, v)
    stretchAbout(v, 'y', cursor, 0.5)
    expect(ppuY(v)).toBeCloseTo(30, 12)
    expect(ppuX(v)).toBe(60)
    expect(v.center.x).toBe(1)
    expect(close(toMath(cursor, v).y, before.y)).toBe(true)
  })

  it('a drag on the numbers keeps the grabbed number under the pointer', () => {
    const v = vp()
    const centre = { x: 400, y: 300 }
    // Grab "3" on the x-axis (180 px right of centre) and drag it to 360 px.
    const start = toScreen({ x: 3, y: 0 }, v).x
    const f = dragStretchFactor(start, start + 180, centre.x)
    setAxisScale(v, 'x', 60 * f, centre)
    expect(toScreen({ x: 3, y: 0 }, v).x).toBeCloseTo(start + 180, 9)
    expect(ppuY(v)).toBe(60)
    expect(v.center).toEqual({ x: 0, y: 0 })
  })

  it('a y drag upward on a number above the centre spreads the y numbers', () => {
    const start = 300 - 120
    const f = dragStretchFactor(start, start - 60, 300)
    expect(f).toBeCloseTo(1.5, 12)
    // Near the centre the lever is floored: a wobble cannot rescale the board.
    expect(dragStretchFactor(302, 303, 300)).toBeCloseTo(1 + 1 / 60, 12)
    // And dragging through the centre never flips the axis.
    expect(dragStretchFactor(420, 0, 400)).toBeGreaterThan(0)
  })

  it('the wheel modifiers pick the axis; a pinch still zooms', () => {
    const base = { ctrlKey: false, metaKey: false, deltaY: 100 }
    expect(wheelStretchAxis({ ...base, shiftKey: true })).toBe('x')
    expect(wheelStretchAxis({ ...base, altKey: true })).toBe('y')
    expect(wheelStretchAxis({ ...base, ctrlKey: true, altKey: true })).toBeNull()
    expect(wheelStretchAxis(base)).toBeNull()
    // Browsers turn ⇧-wheel into a horizontal scroll.
    expect(wheelStretchDelta({ ...base, shiftKey: true, deltaY: 0, deltaX: 100 }).deltaY).toBe(100)
  })
})

describe('Axes: Equal re-squares', () => {
  it('keeps the centre and the x scale', () => {
    const v = vp({ center: { x: 2000, y: 300 }, pxPerUnit: 18, pxPerUnitY: 3 })
    squareAxes(v)
    expect(v.pxPerUnitY).toBeUndefined()
    expect(isStretched(v)).toBe(false)
    expect(v.pxPerUnit).toBe(18)
    expect(v.center).toEqual({ x: 2000, y: 300 })
  })

  it('Independent keeps whatever the view already is', () => {
    const v = vp({ pxPerUnit: 33 })
    makeIndependent(v)
    expect(axesModeOf(v)).toBe('independent')
    expect(ppuY(v)).toBe(33)
    expect(isStretched(v)).toBe(false)
  })

  it('Square it (ZSquare) keeps the whole window in view', () => {
    const v = vp({ center: { x: 5, y: 5 }, pxPerUnit: 40, pxPerUnitY: 10 })
    const before = readWindow(v)
    squareToContain(v)
    const after = readWindow(v)
    expect(isStretched(v)).toBe(false)
    expect(after.xMin).toBeLessThanOrEqual(before.xMin + 1e-9)
    expect(after.xMax).toBeGreaterThanOrEqual(before.xMax - 1e-9)
    expect(after.yMin).toBeLessThanOrEqual(before.yMin + 1e-9)
    expect(after.yMax).toBeGreaterThanOrEqual(before.yMax - 1e-9)
  })
})

describe('polar ruling and Independent axes exclude each other', () => {
  it('polar is refused on Independent axes, allowed on equal ones', () => {
    expect(rulingRefused('polar', vp({ pxPerUnitY: 20 }))).toBe(true)
    expect(rulingRefused('polar', vp({ pxPerUnitY: 60 }))).toBe(true)
    expect(rulingRefused('polar', vp())).toBe(false)
    expect(rulingRefused('cartesian', vp({ pxPerUnitY: 20 }))).toBe(false)
  })

  it('Independent is refused on the polar ruling', () => {
    expect(axesModeRefused('independent', 'polar')).toBe(true)
    expect(axesModeRefused('equal', 'polar')).toBe(false)
    expect(axesModeRefused('independent', 'cartesian')).toBe(false)
  })

  it('a WINDOW on a polar board is fitted inside a square view instead', () => {
    const v = vp()
    const res = applyWindow(v, { xMin: 1985, xMax: 2025, yMin: 200, yMax: 350 }, { keepSquare: true })
    expect(res).toEqual({ ok: true, madeIndependent: false, contained: true })
    expect(v.pxPerUnitY).toBeUndefined()
    const w = readWindow(v)
    expect(w.xMin).toBeLessThanOrEqual(1985)
    expect(w.yMax).toBeGreaterThanOrEqual(350)
  })
})

// ---------------------------------------------------------------------------
// WINDOW
// ---------------------------------------------------------------------------

describe('the WINDOW sets the view exactly', () => {
  it('1985 … 2025 by 200 … 350 is exactly that, and turns Independent on', () => {
    const v = vp()
    const res = applyWindow(v, { xMin: 1985, xMax: 2025, yMin: 200, yMax: 350 })
    expect(res).toEqual({ ok: true, madeIndependent: true, contained: false })
    const w = readWindow(v)
    expect(w.xMin).toBeCloseTo(1985, 9)
    expect(w.xMax).toBeCloseTo(2025, 9)
    expect(w.yMin).toBeCloseTo(200, 9)
    expect(w.yMax).toBeCloseTo(350, 9)
  })

  it('a window in the board’s own proportions keeps equal axes equal', () => {
    const v = vp()
    const res = applyWindow(v, { xMin: -8, xMax: 8, yMin: -6, yMax: 6 })
    expect(res).toEqual({ ok: true, madeIndependent: false, contained: false })
    expect(v.pxPerUnitY).toBeUndefined()
    expect(readWindow(v).xMin).toBeCloseTo(-8, 12)
    expect(readWindow(v).yMax).toBeCloseTo(6, 12)
  })

  it('on Independent axes every window is exact, square or not', () => {
    const v = vp({ pxPerUnitY: 60 })
    const res = applyWindow(v, { xMin: -8, xMax: 8, yMin: -6, yMax: 6 })
    expect(res.ok && res.madeIndependent).toBe(false)
    expect(axesModeOf(v)).toBe('independent')
  })

  it('refuses a window that is not one, and moves nothing', () => {
    const v = vp({ center: { x: 3, y: 4 } })
    expect(applyWindow(v, { xMin: 5, xMax: 5, yMin: 0, yMax: 1 }).ok).toBe(false)
    expect(applyWindow(v, { xMin: 0, xMax: 1, yMin: 2, yMax: 1 }).ok).toBe(false)
    expect(applyWindow(v, { xMin: NaN, xMax: 1, yMin: 0, yMax: 1 }).ok).toBe(false)
    expect(v).toEqual(vp({ center: { x: 3, y: 4 } }))
  })

  it('prints the view sensibly', () => {
    expect(formatWindowValue(1985, 40)).toBe('1985')
    expect(formatWindowValue(-6.666666666, 13.33)).toBe('-6.67')
    expect(formatWindowValue(-0.00001, 10)).toBe('0')
    expect(formatWindowValue(349.9999999999, 150)).toBe('350')
  })
})

// ---------------------------------------------------------------------------
// fitting
// ---------------------------------------------------------------------------

const CENSUS = { min: { x: 1990, y: 249 }, max: { x: 2020, y: 331 } }
const YEARS_VS_MILLIONS = { min: { x: 1990, y: 0 }, max: { x: 2020, y: 3000 } }

describe('fit to curves and zoom to data', () => {
  it('Independent fits each axis to its own extent', () => {
    const v = vp({ pxPerUnitY: 60 })
    fitBox(v, CENSUS, { independent: true })
    const w = readWindow(v)
    // 12% margin each side: the box fills 76% of each axis.
    expect((CENSUS.max.x - CENSUS.min.x) * ppuX(v)).toBeCloseTo(800 * 0.76, 6)
    expect((CENSUS.max.y - CENSUS.min.y) * ppuY(v)).toBeCloseTo(600 * 0.76, 6)
    expect((w.xMin + w.xMax) / 2).toBeCloseTo(2005, 9)
  })

  it('Equal fits square', () => {
    const v = vp()
    fitBox(v, CENSUS, { independent: false })
    expect(v.pxPerUnitY).toBeUndefined()
  })

  it('a flat line does not zoom one axis to infinity', () => {
    const v = vp({ pxPerUnitY: 60 })
    fitBox(v, { min: { x: -4, y: 3 }, max: { x: 4, y: 3 } }, { independent: true })
    expect(ppuY(v)).toBe(ppuX(v))
  })

  it('zoom to data on lopsided data turns Independent on by itself', () => {
    const v = vp()
    expect(boxAspectExcess(v, YEARS_VS_MILLIONS)).toBeGreaterThan(DATA_ASPECT_LIMIT)
    expect(fitData(v, YEARS_VS_MILLIONS)).toEqual({ madeIndependent: true })
    expect(axesModeOf(v)).toBe('independent')
    const w = readWindow(v)
    expect(w.xMin).toBeLessThan(1990)
    expect(w.xMax).toBeGreaterThan(2020)
    expect(w.yMin).toBeLessThan(0)
    expect(w.yMax).toBeGreaterThan(3000)
    // …and the data fills the board both ways.
    expect(3000 * ppuY(v)).toBeGreaterThan(0.7 * 600)
    expect(30 * ppuX(v)).toBeGreaterThan(0.7 * 800)
  })

  it('the census table (1990–2020 against 249–331) is framed readably on a real board', () => {
    const v = vp({ widthPx: 818, heightPx: 889 })
    expect(fitData(v, CENSUS)).toEqual({ madeIndependent: true })
    expect(30 * ppuX(v)).toBeCloseTo(818 * 0.76, 6)
    expect(82 * ppuY(v)).toBeCloseTo(889 * 0.76, 6)
  })

  it('zoom to data on data in proportion stays square', () => {
    const v = vp()
    expect(fitData(v, { min: { x: 0, y: 0 }, max: { x: 8, y: 5 } })).toEqual({ madeIndependent: false })
    expect(axesModeOf(v)).toBe('equal')
  })

  it('never turns Independent on under the polar ruling', () => {
    const v = vp()
    expect(fitData(v, YEARS_VS_MILLIONS, { keepSquare: true })).toEqual({ madeIndependent: false })
    expect(axesModeOf(v)).toBe('equal')
  })
})

// ---------------------------------------------------------------------------
// pointers: snapping, hit radii, sketches, the numbers' bands
// ---------------------------------------------------------------------------

describe('a pointer-placed point snaps per axis', () => {
  it('each axis snaps to its own ladder', () => {
    const v = vp({ pxPerUnit: 20, pxPerUnitY: 2 })
    expect(snapStep(v, 'x')).toBeLessThan(snapStep(v, 'y'))
    const p = snapPlaced({ x: 2003.37, y: 287.3 }, v)
    expect(p.x).toBe(snapCoord(2003.37, v, 'x'))
    expect(p.y).toBe(snapCoord(287.3, v, 'y'))
    expect(Math.abs(p.y - 287.3)).toBeLessThanOrEqual(snapStep(v, 'y') / 2 + 1e-9)
    expect(Number.isInteger(Math.round(p.y / snapStep(v, 'y')))).toBe(true)
  })

  it('an equal board snaps exactly as it always did', () => {
    const v = vp()
    expect(snapStep(v, 'y')).toBe(snapStep(v, 'x'))
    expect(snapPlaced({ x: -0.041667, y: 1.975 }, v)).toEqual({ x: 0, y: 2 })
  })
})

describe('hit testing is in screen pixels on a stretched board', () => {
  const line: FittedCurve = {
    id: 'l',
    modelId: 'line',
    params: [1, 0],
    kind: 'explicit',
    domain: null,
    color: '#fff',
    strokeWidth: 2,
    visible: true,
    error: 0,
  }

  it('a press 7 px off the drawn line is on it; 12 px off is not', () => {
    // y = x on a board whose y axis is squashed tenfold.
    const v = vp({ pxPerUnit: 60, pxPerUnitY: 6 })
    expect(MODELS.line).toBeDefined()
    const poly = sampleCurveScreen(line, MODELS, v)
    const on = toScreen({ x: 1, y: 1 }, v)
    const body = hitRadii(false).body
    const near = nearestOnPolyline({ x: on.x, y: on.y - 7 }, poly)!
    const far = nearestOnPolyline({ x: on.x, y: on.y - 12 }, poly)!
    // The line is nearly flat on screen, so 7 px up is ~7 px away.
    expect(near.dist).toBeLessThanOrEqual(body)
    expect(far.dist).toBeGreaterThan(body)
    // A math distance scaled by ONE ppu would have called 12 px up a hit:
    // the math point is 1.2/6… units off, nothing like 12 px.
    const math = toMath({ x: on.x, y: on.y - 12 }, v)
    const naive = (Math.abs(math.y - math.x) / Math.SQRT2) * ppuX(v)
    expect(naive).toBeGreaterThan(body)
    expect(screenDist({ x: 1, y: 1 }, math, v)).toBeCloseTo(12, 9)
  })
})

describe('a sketch on a stretched board is processed as drawn', () => {
  /** A circle of radius r px drawn on SCREEN, in math coords. */
  function screenCircle(v: Viewport, r: number, n = 120): Vec2[] {
    const out: Vec2[] = []
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * 2 * Math.PI * 0.99
      out.push(toMath({ x: 400 + r * Math.cos(t), y: 300 + r * Math.sin(t) }, v))
    }
    return out
  }

  it('an equal board gives exactly the result it always gave', () => {
    const raw = screenCircle(vp(), 100)
    const a = processStroke(raw, vp())
    const b = processStroke(raw, vp({ pxPerUnitY: 60 }))
    expect(b).toEqual(a)
  })

  it('resamples evenly along the ink ON SCREEN, and still sees it close', () => {
    const v = vp({ center: { x: 2005, y: 290 }, pxPerUnit: 20, pxPerUnitY: 1.5 })
    const out = processStroke(screenCircle(v, 120), v)
    expect(out.closed).toBe(true)
    const steps: number[] = []
    for (let i = 1; i < out.points.length; i++) {
      steps.push(screenDist(out.points[i - 1], out.points[i], v))
    }
    const mean = steps.reduce((s, d) => s + d, 0) / steps.length
    const spread = Math.max(...steps) / Math.min(...steps)
    expect(mean).toBeGreaterThan(1)
    // Even on screen (a math-space resample would bunch up by ~13x here).
    expect(spread).toBeLessThan(1.6)
    // The processed ink still lies on the circle that was drawn.
    for (const p of out.points) {
      const s = toScreen(p, v)
      expect(Math.abs(Math.hypot(s.x - 400, s.y - 300) - 120)).toBeLessThan(2)
    }
  })
})

describe('the axis numbers are a stretch handle', () => {
  it('just under the x-axis is x, just left of the y-axis is y', () => {
    const v = vp()
    // Axes through the centre: x-axis at y = 300, y-axis at x = 400.
    expect(axisBandAt(v, { x: 600, y: 312 })).toBe('x')
    expect(axisBandAt(v, { x: 380, y: 120 })).toBe('y')
  })

  it('a curve crossing an axis is still ink: above the x-axis, right of the y-axis', () => {
    const v = vp()
    expect(axisBandAt(v, { x: 600, y: 296 })).toBeNull()
    expect(axisBandAt(v, { x: 404, y: 120 })).toBeNull()
    expect(axisBandAt(v, { x: 600, y: 350 })).toBeNull()
  })

  it('the origin corner belongs to neither', () => {
    expect(axisBandAt(vp(), { x: 390, y: 310 })).toBeNull()
  })

  it('follows the numbers to the edge when the axis is off screen', () => {
    // Census window: the x-axis (y = 0) is far below, so the x numbers sit
    // on the bottom edge; the y-axis (x = 0) is far left, numbers on the left.
    const v = vp({ center: { x: 2005, y: 275 }, pxPerUnit: 20, pxPerUnitY: 4 })
    expect(axisBandAt(v, { x: 500, y: 590 })).toBe('x')
    expect(axisBandAt(v, { x: 20, y: 200 })).toBe('y')
    expect(axisBandAt(v, { x: 500, y: 300 })).toBeNull()
  })
})

describe('a population axis is not pinned by the zoom clamp', () => {
  it('fits x in years against y in hundreds of millions, and saves the scale intact', () => {
    // Before: MIN_PPU = 0.001 pinned ppuY, and the census collapsed to a band
    // 0.7 million tall around its middle.
    expect(MIN_PPU).toBeLessThanOrEqual(1e-8)
    const tiny = 3.1234567e-6
    expect(clampPpu(tiny)).toBe(tiny)
  })
})

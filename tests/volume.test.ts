// ============================================================================
// tests/volume.test.ts — volumes of solids (AP Calculus Unit 8): the numbers
// (disks, washers, shells, known cross-sections, the dy pairings, the axis
// through the region), the exact forms, the written integrals, the link in a
// file (old documents byte-identical), what dies with what, the card's edits,
// where a fresh one opens, and what it draws — on screen and in the SAT
// figure, in the one mono ink.
//
// Every expected value below was worked by hand first:
//   √x on [0, 4] about the x-axis        π∫₀⁴ x dx = 8π
//   y = x, y = x² about the x-axis        π∫₀¹ (x² − x⁴) dx = π(1/3 − 1/5) = 2π/15
//   the same region about y = 2           π∫₀¹ ((2 − x²)² − (2 − x)²) dx
//                                         = π∫₀¹ (x⁴ − 5x² + 4x) dx = π(1/5 − 5/3 + 2) = 8π/15
//   the same region about y = −1          π∫₀¹ ((x + 1)² − (x² + 1)²) dx = π∫₀¹ (2x − x² − x⁴) dx
//                                         = π(1 − 1/3 − 1/5) = 7π/15
//   the same region about the y-axis      shells 2π∫₀¹ x(x − x²) dx = 2π(1/3 − 1/4) = π/6
//                                         washers π∫₀¹ ((√y)² − y²) dy = π(1/2 − 1/3) = π/6
//   the same region about x = 2           2π∫₀¹ (2 − x)(x − x²) dx = 2π(1 − 2/3 − 1/3 + 1/4) = π/2
//   y = x² on [0, 2] about the y-axis     2π∫₀² x·x² dx = 2π·4 = 8π
//                                         = π∫₀⁴ (2² − (√y)²) dy = π(16 − 8) = 8π
//   squares on √x over [0, 4]             ∫₀⁴ x dx = 8
//   semicircles (diameter s)              (π/8)·8 = π
//   equilateral triangles                 (√3/4)·8 = 2√3
// ============================================================================

import { describe, expect, it } from 'vitest'
import type { FittedCurve, ModelSpec } from '../src/core/types'
import { CURVE_COLORS, DARK_THEME, FIGURE_STYLES } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { parseExpression } from '../src/core/parse'
import {
  calcLinkToStored,
  calcNoun,
  boardToStored,
  deserializeDoc,
  docFromBoard,
  serializeDoc,
  storedToCalcLink,
} from '../src/core/persist'
import type { BoardInput, CalcLink, DocMeta, VolumeLink } from '../src/core/persist'
import {
  exactVolume,
  horizontalBands,
  sectionFactor,
  sectionVolume,
  shellVolume,
  shellVolumeDy,
  tanhSinh,
  washerVolume,
  washerVolumeDy,
} from '../src/core/volume'
import type { Region } from '../src/core/volume'
import { cardCalc, changeLabel, dependentsOf, followDomains, linkNoun, overlaysFor } from '../src/ui/calcLinks'
import {
  applyVolumeChange,
  defaultVolume,
  sectionOutline,
  volumeOverlays,
  volumeRow,
  volumeSliceHandle,
} from '../src/ui/volumeLinks'
import { renderBoard, type BoardScene } from '../src/ui/renderBoard'
import { hasOverlayMarks, isOverlayMark } from '../src/render/overlays'
import { MockCtx, MockPath2D, withMockPath2D, type Cmd } from './mockCanvas'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const curve = (id: string, modelId: string, params: number[], over: Partial<FittedCurve> = {}): FittedCurve => ({
  id,
  modelId,
  params,
  kind: 'explicit',
  domain: null,
  color: CURVE_COLORS[0],
  strokeWidth: 2.5,
  visible: true,
  error: 0,
  ...over,
})

/** Typed lines as the board registers them: their curves, and the models with them. */
function typed(lines: Record<string, string>): { c: Record<string, FittedCurve>; models: Record<string, ModelSpec> } {
  const c: Record<string, FittedCurve> = {}
  const models: Record<string, ModelSpec> = { ...MODELS }
  let i = 0
  for (const [id, src] of Object.entries(lines)) {
    const out = parseExpression(src)
    if (!out.ok) throw new Error(out.error)
    const mid = `expr_${++i}`
    models[mid] = out.plot.makeModel(mid)
    c[id] = curve(id, mid, out.plot.defaultParams.slice(), { color: CURVE_COLORS[i % CURVE_COLORS.length] })
  }
  return { c, models }
}

const zero = (): number => 0
const reg = (f: (x: number) => number, g: (x: number) => number, a: number, b: number): Region => ({ f, g, a, b })
const X = (x: number): number => x
const X2 = (x: number): number => x * x

const PI = Math.PI
const near = (v: number, want: number, rel = 1e-12): void => {
  expect(Math.abs(v - want)).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(want)))
}

const LINK: VolumeLink = { kind: 'volume', id: 'V', parentId: 'f', a: 0, b: 4, method: 'washer' }

// ===========================================================================
// The numbers
// ===========================================================================

describe('tanh-sinh quadrature', () => {
  it('integrates √x on [0, 4] to the last bits, endpoint singularity and all', () => {
    near(tanhSinh(Math.sqrt, 0, 4)!.value, 16 / 3, 1e-14)
  })
  it('is signed by orientation and zero on an empty interval', () => {
    near(tanhSinh(X2, 1, 0)!.value, -1 / 3, 1e-14)
    expect(tanhSinh(X2, 2, 2)!.value).toBe(0)
  })
  it('refuses a hole in the middle', () => {
    expect(tanhSinh((x) => (Math.abs(x - 0.5) < 0.01 ? Number.NaN : x), 0, 1)).toBeNull()
  })
})

describe('disks and washers about a horizontal axis (dx)', () => {
  it('√x on [0, 4] about the x-axis: 8π', () => {
    const v = washerVolume(reg(Math.sqrt, zero, 0, 4), 0)!
    near(v.value, 8 * PI)
    expect(v.through).toBe(false)
  })
  it('y = x and y = x² about the x-axis: 2π/15', () => {
    near(washerVolume(reg(X, X2, 0, 1), 0)!.value, (2 * PI) / 15)
  })
  it('the same region about y = 2: 8π/15 — R = 2 − x², r = 2 − x', () => {
    near(washerVolume(reg(X, X2, 0, 1), 2)!.value, (8 * PI) / 15)
  })
  it('the same region about y = −1: 7π/15 — R = x + 1, r = x² + 1', () => {
    near(washerVolume(reg(X, X2, 0, 1), -1)!.value, (7 * PI) / 15)
  })
  it('does not care which curve is f and which is g', () => {
    near(washerVolume(reg(X2, X, 0, 1), 2)!.value, (8 * PI) / 15)
  })
  it('a region below the axis revolves to the same solid as its mirror image', () => {
    near(washerVolume(reg((x) => -Math.sqrt(x), zero, 0, 4), 0)!.value, 8 * PI)
  })
})

describe('shells about a vertical axis (dx)', () => {
  it('y = x² on [0, 2] (to the x-axis) about the y-axis: 8π', () => {
    near(shellVolume(reg(X2, zero, 0, 2), 0)!.value, 8 * PI)
  })
  it('y = x and y = x² about the y-axis: π/6; about x = 2: π/2', () => {
    near(shellVolume(reg(X, X2, 0, 1), 0)!.value, PI / 6)
    near(shellVolume(reg(X, X2, 0, 1), 2)!.value, PI / 2)
  })
})

describe('known cross-sections', () => {
  const base = reg(Math.sqrt, zero, 0, 4)
  it('squares on √x over [0, 4]: 8', () => near(sectionVolume(base, 'square')!.value, 8))
  it('semicircles: π', () => near(sectionVolume(base, 'semicircle')!.value, PI))
  it('equilateral triangles: 2√3', () => near(sectionVolume(base, 'equilateral')!.value, 2 * Math.sqrt(3)))
  it('isosceles right triangles: 4 (leg on the base) and 2 (hypotenuse on the base)', () => {
    near(sectionVolume(base, 'isoRightLeg')!.value, 4)
    near(sectionVolume(base, 'isoRightHyp')!.value, 2)
  })
  it('rectangles of height 2·base: 16', () => near(sectionVolume(base, 'rectangle', 2)!.value, 16))
  it('the area factors', () => {
    expect(sectionFactor('square')).toBe(1)
    near(sectionFactor('semicircle'), PI / 8)
    near(sectionFactor('equilateral'), Math.sqrt(3) / 4)
    expect(sectionFactor('isoRightLeg')).toBe(0.5)
    expect(sectionFactor('isoRightHyp')).toBe(0.25)
    expect(sectionFactor('rectangle', 3)).toBe(3)
  })
})

describe('slicing in dy', () => {
  it('y = x and y = x²: one strip from x = y to x = √y at every height', () => {
    const r = reg(X, X2, 0, 1)
    const bands = horizontalBands(r)!
    expect(bands).toHaveLength(1)
    expect(bands[0].y0).toBe(0)
    expect(bands[0].y1).toBe(1)
    expect(bands[0].left).toMatchObject({ kind: 'curve', which: 'f' })
    expect(bands[0].right).toMatchObject({ kind: 'curve', which: 'g' })
    // Washers about the y-axis in dy measure what shells in dx measure.
    near(washerVolumeDy(r, bands, 0)!.value, PI / 6, 1e-12)
    // Shells about the x-axis in dy measure what washers in dx measure.
    near(shellVolumeDy(r, bands, 0)!.value, (2 * PI) / 15, 1e-12)
  })
  it('y = x² on [0, 2]: from x = √y out to the edge x = 2', () => {
    const r = reg(X2, zero, 0, 2)
    const bands = horizontalBands(r)!
    expect(bands).toHaveLength(1)
    expect(bands[0].right).toEqual({ kind: 'edge', x: 2 })
    near(washerVolumeDy(r, bands, 0)!.value, 8 * PI, 1e-12)
  })
  it('y = x² on [−1, 2]: two strips at low heights — no single dy description', () => {
    expect(horizontalBands(reg(X2, zero, -1, 2))).toBeNull()
  })
})

describe('the axis through the region', () => {
  it('washers: R is the larger distance and r = 0 where the axis cuts the region', () => {
    const r = reg(X, X2, 0, 1)
    const v = washerVolume(r, 0.5)!
    expect(v.through).toBe(true)
    // Independent: the folded region, slice by slice, with plain Simpson.
    const n = 20000
    let s = 0
    for (let i = 0; i <= n; i++) {
      const x = i / n
      const t = x - 0.5
      const u = x * x - 0.5
      const w = i === 0 || i === n ? 1 : i % 2 ? 4 : 2
      const v2 = u >= 0 ? t * t - u * u : t <= 0 ? u * u - t * t : Math.max(t * t, u * u)
      s += w * v2
    }
    near(v.value, (PI * s) / (3 * n), 1e-8)
  })
  it('shells: the folded region — and washers in dy agree with it', () => {
    const r = reg(X, X2, 0, 1)
    const sh = shellVolume(r, 0.5)!
    expect(sh.through).toBe(true)
    const dy = washerVolumeDy(r, horizontalBands(r)!, 0.5)!
    expect(dy.through).toBe(true)
    near(sh.value, dy.value, 1e-9)
    // ... and it is NOT the textbook integral, which counts the overlap twice.
    const naive = 2 * PI * tanhSinh((x) => Math.abs(x - 0.5) * (x - x * x), 0, 1)!.value
    expect(sh.value).toBeLessThan(naive - 1e-3)
  })
  it('an axis on the edge of the region is not through it', () => {
    expect(washerVolume(reg(X, X2, 0, 1), 0)!.through).toBe(false)
    expect(shellVolume(reg(X, X2, 0, 1), 0)!.through).toBe(false)
    expect(shellVolume(reg(X, X2, 0, 1), 1)!.through).toBe(false)
  })
})

describe('exact forms', () => {
  it('rational multiples of π, of π², surds and rationals', () => {
    expect(exactVolume(8 * PI)!.text).toBe('8π')
    expect(exactVolume((2 * PI) / 15)).toEqual({ text: '2π/15', tex: '\\frac{2\\pi}{15}' })
    expect(exactVolume(PI / 6)!.text).toBe('π/6')
    expect(exactVolume(PI)!.text).toBe('π')
    expect(exactVolume(2 * PI * PI)!.text).toBe('2π²')
    expect(exactVolume(2 * Math.sqrt(3))!.text).toBe('2√3')
    expect(exactVolume(8)!.text).toBe('8')
  })
  it('never dresses up a number measured roughly', () => {
    expect(exactVolume(8 * PI, 1e-5)).toBeNull()
    expect(exactVolume(1.2345678)).toBeNull()
  })
})

// ===========================================================================
// The card
// ===========================================================================

describe('the card', () => {
  const { c, models } = typed({ f: 'y = x', g: 'y = x^2', s: 'y = sqrt(x)' })
  const sources = { f: 'y = x', g: 'y = x^2', s: 'y = sqrt(x)' }
  const row = (l: VolumeLink, parent: string, other?: string) =>
    volumeRow(l, c[parent], other ? c[other] : undefined, models, {
      fName: parent,
      gName: other ?? 'g',
      sources,
    })

  it('disks: π∫_0^4 (√x)² dx = 8π', () => {
    const r = row({ ...LINK, parentId: 's' }, 's')
    expect(r.head).toBe('Disks about the x-axis')
    expect(r.integral!.text).toBe('π∫_0^4 (√x)² dx')
    expect(r.integral!.tex).toBe('\\pi\\int_{0}^{4} \\left(\\sqrt{x}\\right)^{2}\\,dx')
    expect(r.value).toBe('V = 8π ≈ 25.133')
    expect(r.parts).toContain('R(x) = √x (outer radius)')
    expect(r.warning).toBeNull()
  })

  it('washers about the x-axis: π∫_0^1 (x² − (x²)²) dx = 2π/15', () => {
    const r = row({ ...LINK, otherId: 'g', a: 0, b: 1 }, 'f', 'g')
    expect(r.head).toBe('Washers about the x-axis')
    expect(r.integral!.text).toBe('π∫_0^1 (x² − (x²)²) dx')
    expect(r.value).toBe('V = 2π/15 ≈ 0.419')
    expect(r.parts).toEqual(['R(x) = x (outer radius)', 'r(x) = x² (inner radius)'])
  })

  it('washers about y = 2: R = 2 − x², r = 2 − x, V = 8π/15', () => {
    const r = row({ ...LINK, otherId: 'g', a: 0, b: 1, axis: { dir: 'h', at: 2 } }, 'f', 'g')
    expect(r.head).toBe('Washers about y = 2')
    expect(r.integral!.text).toBe('π∫_0^1 ((2 − x²)² − (2 − x)²) dx')
    expect(r.value).toBe('V = 8π/15 ≈ 1.676')
  })

  it('shells about the y-axis: 2π∫_0^2 x·x² dx = 8π', () => {
    const r = row({ ...LINK, parentId: 'g', a: 0, b: 2, method: 'shell', axis: { dir: 'v', at: 0 } }, 'g')
    expect(r.head).toBe('Shells about the y-axis')
    expect(r.integral!.text).toBe('2π∫_0^2 x·x² dx')
    expect(r.value).toBe('V = 8π ≈ 25.133')
  })

  it('shells about x = 2: 2π∫_0^1 (2 − x)(x − x²) dx', () => {
    const r = row({ ...LINK, otherId: 'g', a: 0, b: 1, method: 'shell', axis: { dir: 'v', at: 2 } }, 'f', 'g')
    expect(r.integral!.text).toBe('2π∫_0^1 (2 − x)(x − x²) dx')
    expect(r.value).toBe('V = π/2 ≈ 1.571')
  })

  it('squares, semicircles, equilateral triangles on √x', () => {
    const sq = row({ ...LINK, parentId: 's', method: 'section' }, 's')
    expect(sq.head).toBe('Squares ⟂ x-axis')
    expect(sq.integral!.text).toBe('∫_0^4 (√x)² dx')
    expect(sq.value).toBe('V = 8')
    const semi = row({ ...LINK, parentId: 's', method: 'section', section: 'semicircle' }, 's')
    expect(semi.integral!.text).toBe('(π/8)∫_0^4 (√x)² dx')
    expect(semi.value).toBe('V = π ≈ 3.142')
    const eq = row({ ...LINK, parentId: 's', method: 'section', section: 'equilateral' }, 's')
    expect(eq.value).toBe('V = 2√3 ≈ 3.464')
    expect(eq.parts).toContain('A(s) = (√3/4)s²')
  })

  it('washers about the y-axis slice in dy, with the inverse written in y', () => {
    const r = row({ ...LINK, otherId: 'g', a: 0, b: 1, axis: { dir: 'v', at: 0 } }, 'f', 'g')
    expect(r.need).toBeNull()
    expect(r.integral!.text).toBe('π∫_0^1 ((√y)² − y²) dy')
    expect(r.value).toBe('V = π/6 ≈ 0.524')
    expect(r.sliceVar).toBe('y')
    const edge = row({ ...LINK, parentId: 'g', a: 0, b: 2, axis: { dir: 'v', at: 0 } }, 'g')
    expect(edge.integral!.text).toBe('π∫_0^4 (2² − (√y)²) dy')
  })

  it('shells about the x-axis slice in dy too', () => {
    const r = row({ ...LINK, otherId: 'g', a: 0, b: 1, method: 'shell', axis: { dir: 'h', at: 0 } }, 'f', 'g')
    expect(r.integral!.text).toBe('2π∫_0^1 y(√y − y) dy')
    expect(r.value).toBe('V = 2π/15 ≈ 0.419')
  })

  it('a dy pairing that cannot be sliced says what it needs, and which method works', () => {
    const r = row({ ...LINK, parentId: 'g', a: -1, b: 2, axis: { dir: 'v', at: 0 } }, 'g')
    expect(r.integral).toBeNull()
    expect(r.need!.text).toContain('Use shells for this axis')
    expect(r.need!.switchTo).toBe('shell')
    // The number is still the solid's.
    expect(r.value).toMatch(/^V /)
  })

  it('the axis through the region is said, not refused', () => {
    const r = row({ ...LINK, otherId: 'g', a: 0, b: 1, axis: { dir: 'h', at: 0.5 } }, 'f', 'g')
    expect(r.warning).toMatch(/axis passes through the region/)
    expect(r.value).toMatch(/^V ≈ 0\.22/)
    const s = row({ ...LINK, otherId: 'g', a: 0, b: 1, method: 'shell', axis: { dir: 'v', at: 0.5 } }, 'f', 'g')
    expect(s.warning).toMatch(/axis passes through the region/)
    expect(s.integral).toBeNull()
  })

  it('a sketch is written by its letter', () => {
    const p = curve('p', 'poly2', [0, 0, 1])
    const r = volumeRow({ ...LINK, parentId: 'p', a: 0, b: 2 }, p, undefined, MODELS, { fName: 'h' })
    expect(r.integral!.text).toBe('π∫_0^2 h(x)² dx')
    expect(r.value).toBe('V = 32π/5 ≈ 20.106')
  })

  it('refusals in words', () => {
    expect(row({ ...LINK, parentId: 's', a: -1 }, 's').problem).toContain('s is undefined at x = −1')
    expect(row({ ...LINK, parentId: 's', a: 2, b: 2 }, 's').problem).toContain('same point')
    expect(volumeRow(LINK, undefined, undefined, models).problem).toContain('gone')
    const h = typed({ h: 'y = 1/x' })
    const pole = volumeRow({ ...LINK, parentId: 'h', a: -1, b: 1 }, h.c.h, undefined, h.models, { fName: 'h' })
    expect(pole.problem).toBeTruthy()
  })

  it('cardCalc puts the row on the parent, with the region choices', () => {
    const links: CalcLink[] = [{ ...LINK, otherId: 'g', a: 0, b: 1 }]
    const cards = cardCalc(links, [c.f, c.g], models, (cv) => cv.id, { f: 'f', g: 'g' }, {}, sources)
    expect(cards.f.volumes).toHaveLength(1)
    expect(cards.f.volumes[0].others.map((o) => o.id)).toEqual(['g'])
    expect(cards.f.volumes[0].integral!.text).toBe('π∫_0^1 (x² − (x²)²) dx')
    expect(cards.g.volumes).toHaveLength(0)
  })
})

// ===========================================================================
// The file
// ===========================================================================

const META: DocMeta = { id: 'doc1', name: 'Volume', createdAt: 1000, modifiedAt: 1000 }

function board(over: Partial<BoardInput> = {}): BoardInput {
  return {
    curves: [],
    styles: {},
    candidates: new Map(),
    exprSources: {},
    viewport: { center: { x: 0, y: 0 }, pxPerUnit: 60 },
    selectedId: null,
    mode: 'draw',
    ...over,
  }
}

describe('the volume link in a file', () => {
  it('writes a and b, and nothing that is the default', () => {
    expect(calcLinkToStored(LINK)).toEqual({ kind: 'volume', id: 'V', parentId: 'f', a: 0, b: 4 })
    expect(Object.keys(calcLinkToStored({ ...LINK, axis: { dir: 'h', at: 0 }, section: 'square', ratio: 1 }))).toEqual([
      'kind',
      'id',
      'parentId',
      'a',
      'b',
    ])
  })

  it('writes what is not the default', () => {
    expect(
      calcLinkToStored({ ...LINK, otherId: 'g', method: 'shell', axis: { dir: 'v', at: -1 }, x: 1.5 }),
    ).toEqual({ kind: 'volume', id: 'V', parentId: 'f', otherId: 'g', a: 0, b: 4, method: 'shell', axis: { dir: 'v', at: -1 }, x: 1.5 })
    expect(calcLinkToStored({ ...LINK, method: 'section', section: 'rectangle', ratio: 2 })).toEqual({
      kind: 'volume', id: 'V', parentId: 'f', a: 0, b: 4, method: 'section', section: 'rectangle', ratio: 2,
    })
    // a section shape or ratio on a link that is not cutting sections is not a fact about it
    expect(calcLinkToStored({ ...LINK, section: 'semicircle', ratio: 3 })).toEqual({
      kind: 'volume', id: 'V', parentId: 'f', a: 0, b: 4,
    })
  })

  it('reads back what it wrote, and defaults what is junk', () => {
    const full: VolumeLink = {
      ...LINK, otherId: 'g', method: 'section', section: 'rectangle', ratio: 0.5, x: 2,
    }
    expect(storedToCalcLink(calcLinkToStored(full))).toEqual(full)
    expect(storedToCalcLink({ kind: 'volume', id: 'V', parentId: 'f', a: 0, b: 4, method: 'cube', axis: { dir: 'z', at: 1 }, x: 'no' })).toEqual(LINK)
    expect(storedToCalcLink({ kind: 'volume', id: 'V', parentId: 'f', a: 0, b: 4, axis: { dir: 'v', at: Infinity } })).toEqual(LINK)
    expect(storedToCalcLink({ kind: 'volume', id: 'V', parentId: 'f', a: 0, b: 4, method: 'section', section: 'blob' })).toEqual({
      ...LINK, method: 'section',
    })
  })

  it('refuses a volume without both ends', () => {
    expect(storedToCalcLink({ kind: 'volume', id: 'V', parentId: 'f', a: 0 })).toBeNull()
    expect(storedToCalcLink({ kind: 'volume', id: 'V', parentId: 'f', a: 'x', b: 1 })).toBeNull()
    expect(storedToCalcLink({ kind: 'volume', id: 'V', parentId: 'f', a: 0, b: Infinity })).toBeNull()
  })

  it('round-trips through a whole document', () => {
    const { c } = typed({ f: 'y = x', g: 'y = x^2' })
    const links: CalcLink[] = [
      { ...LINK, otherId: 'g', a: 0, b: 1, axis: { dir: 'h', at: 2 }, x: 0.25 },
      { ...LINK, id: 'W', otherId: 'g', a: 0, b: 1, method: 'shell', axis: { dir: 'v', at: 0 } },
    ]
    const input = board({ curves: [c.f, c.g], calc: links, exprSources: { f: 'y = x', g: 'y = x^2' } })
    const res = deserializeDoc(serializeDoc(docFromBoard(META, input, 2000)))
    expect(res.board!.calc).toEqual(links)
    expect(res.degraded).toBe(false)
  })

  it('leaves a document written before volumes existed byte-identical', () => {
    const f = curve('f', 'poly2', [-1, 0, 1])
    const g = curve('g', 'poly3', [0, -1, 0, 1 / 3])
    const t = curve('t', 'line', [0, 1])
    const old = board({
      curves: [f, g, t],
      calc: [
        { kind: 'area', id: 'R', parentId: 'f', otherId: 'g', from: 0, to: 2, abs: true },
        { kind: 'riemann', id: 'S', parentId: 'f', from: 0, to: 2, n: 8, method: 'left' },
        { kind: 'tangent', id: 'L', parentId: 'f', curveId: 't', x: 1 },
        { kind: 'secant', id: 'Q', parentId: 'f', a: 1, b: 3 },
      ],
    })
    const text = serializeDoc(docFromBoard(META, old, 2000))
    expect(text).toContain(
      '"calc":[{"kind":"area","id":"R","parentId":"f","otherId":"g","from":0,"to":2,"abs":true},' +
        '{"kind":"riemann","id":"S","parentId":"f","from":0,"to":2,"n":8,"method":"left"},' +
        '{"kind":"tangent","id":"L","parentId":"f","curveId":"t","x":1},' +
        '{"kind":"secant","id":"Q","parentId":"f","a":1,"b":3}]',
    )
    expect(text).not.toContain('volume')
    expect(text).not.toContain('"axis"')
    expect(text).not.toContain('"section"')
    expect(text).not.toContain('"ratio"')
    const round = serializeDoc(docFromBoard(META, deserializeDoc(text).board as never, 2000))
    expect(round).toBe(text)
  })

  it('a lost second curve drops the link on load, and says so', () => {
    const f = curve('f', 'poly2', [0, 0, 1])
    const stored = boardToStored(board({ curves: [f], calc: [{ ...LINK, otherId: 'gone' }] }))
    const raw = { version: 2, id: 'd', name: 'n', createdAt: 1, modifiedAt: 1, board: { ...stored } }
    const res = deserializeDoc(JSON.stringify(raw))
    expect(res.board!.calc).toEqual([])
    expect(res.degraded).toBe(true)
    expect(res.problems.join(' ')).toContain('volume')
    expect(calcNoun('volume')).toBe('volume')
  })
})

// ===========================================================================
// What dies with what; the edits
// ===========================================================================

describe('dependents and edits', () => {
  const link: VolumeLink = { ...LINK, otherId: 'g', a: 0, b: 1 }
  it('deleting f or g takes the volume, and no curve with it', () => {
    expect([...dependentsOf([link], ['f']).linkIds]).toEqual(['V'])
    expect([...dependentsOf([link], ['g']).linkIds]).toEqual(['V'])
    expect([...dependentsOf([link], ['g']).curveIds]).toEqual(['g'])
    expect([...dependentsOf([link], ['h']).linkIds]).toEqual([])
  })

  it('every change has an undo label in words', () => {
    expect(changeLabel({ kind: 'volumeBound', linkId: 'V', which: 'a', value: 0 })).toBe('move volume bound')
    expect(changeLabel({ kind: 'volumeMethod', linkId: 'V', method: 'shell' })).toBe('change volume method')
    expect(changeLabel({ kind: 'volumeAxis', linkId: 'V', axis: { dir: 'h', at: 2 } })).toBe('change axis of revolution')
    expect(changeLabel({ kind: 'volumeSlice', linkId: 'V', x: 1 })).toBe('move slice')
    expect(linkNoun('volume')).toBe('volume')
  })

  const { c, models } = typed({ f: 'y = x', g: 'y = x^2' })
  const ctx = { curves: [c.f, c.g], models, window: [-10, 10] as [number, number] }

  it('shells from the default axis turn to the y-axis; the dy/dx switch drops the slice', () => {
    const next = applyVolumeChange({ ...link, x: 0.3 }, { kind: 'volumeMethod', linkId: 'V', method: 'shell' }, ctx)!
    expect(next.axis).toEqual({ dir: 'v', at: 0 })
    expect(next.x).toBe(0.3) // shells about the y-axis still slice in dx
    const dy = applyVolumeChange({ ...link, x: 0.3 }, { kind: 'volumeAxis', linkId: 'V', axis: { dir: 'v', at: 0 } }, ctx)!
    expect(dy.x).toBeUndefined() // washers about the y-axis slice in dy
    expect(applyVolumeChange(link, { kind: 'volumeAxis', linkId: 'V', axis: { dir: 'h', at: 0 } }, ctx)).toBeNull()
    const back = applyVolumeChange({ ...link, axis: { dir: 'h', at: 2 } }, { kind: 'volumeAxis', linkId: 'V', axis: { dir: 'h', at: 0 } }, ctx)!
    expect('axis' in back).toBe(false)
  })

  it('sections, ratios and the region', () => {
    const sec = applyVolumeChange(link, { kind: 'volumeSection', linkId: 'V', section: 'rectangle' }, ctx)!
    expect(sec.method).toBe('section')
    expect(sec.section).toBe('rectangle')
    const r2 = applyVolumeChange(sec, { kind: 'volumeRatio', linkId: 'V', ratio: 2 }, ctx)!
    expect(r2.ratio).toBe(2)
    expect(applyVolumeChange(sec, { kind: 'volumeRatio', linkId: 'V', ratio: -1 }, ctx)).toBeNull()
    const off = applyVolumeChange(r2, { kind: 'volumeMethod', linkId: 'V', method: 'washer' }, ctx)!
    expect(off.section).toBeUndefined()
    expect(off.ratio).toBeUndefined()
    const axisOnly = applyVolumeChange(link, { kind: 'volumeOther', linkId: 'V', otherId: null }, ctx)!
    expect(axisOnly.otherId).toBeUndefined()
    const again = applyVolumeChange(axisOnly, { kind: 'volumeOther', linkId: 'V', otherId: 'g' }, ctx)!
    expect(again).toMatchObject({ otherId: 'g', a: 0, b: 1 })
  })

  it('a sketch whose end is dragged carries a limit sitting on that end', () => {
    const p = curve('p', 'poly2', [0, 0, 1], { domain: [0, 2] })
    const moved = followDomains([{ ...LINK, parentId: 'p', a: 0, b: 2 }], new Map([['p', [0, 2]]]), [
      { ...p, domain: [0, 3] },
    ])!
    expect(moved[0]).toMatchObject({ a: 0, b: 3 })
  })
})

// ===========================================================================
// Where a fresh one opens
// ===========================================================================

describe('defaultVolume', () => {
  it('√x alone: from its zero, four units in — [0, 4]', () => {
    const { c, models } = typed({ s: 'y = sqrt(x)' })
    expect(defaultVolume(c.s, [c.s], models, [-10, 10])).toEqual({ a: 0, b: 4 })
  })
  it('y = x with y = x² on the board: the region they enclose', () => {
    const { c, models } = typed({ f: 'y = x', g: 'y = x^2' })
    expect(defaultVolume(c.f, [c.f, c.g], models, [-10, 10])).toEqual({ otherId: 'g', a: 0, b: 1 })
  })
  it('4 − x² alone: between its two zeros', () => {
    const { c, models } = typed({ f: 'y = 4 - x^2' })
    expect(defaultVolume(c.f, [c.f], models, [-10, 10])).toEqual({ a: -2, b: 2 })
  })
  it('nothing for a curve that is not a function of x', () => {
    const circ = curve('c', 'circle', [0, 0, 1], { kind: 'implicit' })
    expect(defaultVolume(circ, [circ], MODELS, [-4, 4])).toBeNull()
  })
})

// ===========================================================================
// The figure
// ===========================================================================

const VP = { center: { x: 0, y: 0 }, pxPerUnit: 60, widthPx: 900, heightPx: 700 }
const sxOf = (x: number): number => VP.widthPx / 2 + x * VP.pxPerUnit
const syOf = (y: number): number => VP.heightPx / 2 - y * VP.pxPerUnit

interface Op {
  op: 'fill' | 'stroke' | 'text'
  style: string
  alpha: number
  pts: Cmd[]
  dash: number[]
  text?: string
}

class LogCtx extends MockCtx {
  log: Op[] = []
  private mark = 0
  private dashNow: number[] = []
  override setLineDash(d: number[]): void {
    this.dashNow = d.slice()
    super.setLineDash?.(d)
  }
  private note(op: 'fill' | 'stroke', style: string): void {
    const pts = this.own.cmds.slice(this.mark) as Cmd[]
    this.mark = this.own.cmds.length
    this.log.push({ op, style, alpha: this.globalAlpha, pts, dash: this.dashNow.slice() })
  }
  override fill(): void {
    this.note('fill', this.fillStyle)
    super.fill()
  }
  override stroke(p?: MockPath2D): void {
    this.note('stroke', this.strokeStyle)
    super.stroke(p)
  }
  override fillText(text: string, x: number, y: number): void {
    this.log.push({ op: 'text', style: this.fillStyle, alpha: this.globalAlpha, pts: [], dash: [], text })
    super.fillText?.(text, x, y)
  }
}

function paint(over: Partial<BoardScene>, models: Record<string, ModelSpec>, curves: FittedCurve[]): LogCtx {
  const ctx = new LogCtx()
  const scene: BoardScene = {
    vp: VP,
    theme: DARK_THEME,
    curves,
    styles: {},
    models,
    analysis: null,
    chrome: null,
    ...over,
  }
  withMockPath2D(() => renderBoard(ctx as unknown as CanvasRenderingContext2D, scene))
  return ctx
}

describe('the figure', () => {
  const { c, models } = typed({ f: 'y = x', g: 'y = x^2', s: 'y = sqrt(x)' })

  it('washers about y = 2: the region, its mirror, the axis, the slice, the ellipses, R and r', () => {
    const link: VolumeLink = { ...LINK, otherId: 'g', a: 0, b: 1, axis: { dir: 'h', at: 2 }, x: 0.5 }
    const ovs = volumeOverlays([link], [c.f, c.g], models)
    expect(ovs[0]).toMatchObject({ kind: 'area', curveId: 'f', against: 'g', from: 0, to: 1 })
    const mirror = ovs.find((o) => o.kind === 'path' && o.under === true)!
    expect(mirror).toBeTruthy()
    // The mirror of (1, 1) across y = 2 is (1, 3).
    if (mirror.kind === 'path') {
      expect(mirror.points.some((p) => Math.abs(p.x - 1) < 1e-9 && Math.abs(p.y - 3) < 1e-9)).toBe(true)
    }
    expect(ovs.some((o) => o.kind === 'hline' && o.y === 2 && o.dashed)).toBe(true)
    const labels = ovs.filter((o) => o.kind === 'label').map((o) => (o.kind === 'label' ? o.text : ''))
    expect(labels).toEqual(expect.arrayContaining(['R', 'r', 'axis: y = 2']))
    // R at x = 0.5 is 2 − 0.25 = 1.75: the outer ellipse reaches y = 2 ± 1.75.
    const ellipses = ovs.filter((o) => o.kind === 'path' && o.closed && !o.under && o.points.length > 60)
    const tallest = Math.max(
      ...ellipses.map((o) => (o.kind === 'path' ? Math.max(...o.points.map((p) => p.y)) : 0)),
    )
    near(tallest, 3.75, 1e-9)
    // Marks go on top of the curves, the mirror under them.
    expect(isOverlayMark(mirror)).toBe(false)
    expect(hasOverlayMarks(ovs)).toBe(true)
  })

  it('shells about the y-axis: the strip, its mirror, "r = x" and "h"', () => {
    const link: VolumeLink = { ...LINK, parentId: 'g', a: 0, b: 2, method: 'shell', axis: { dir: 'v', at: 0 }, x: 1 }
    const ovs = volumeOverlays([link], [c.g], models)
    const labels = ovs.filter((o) => o.kind === 'label').map((o) => (o.kind === 'label' ? o.text : ''))
    expect(labels).toEqual(expect.arrayContaining(['r = x', 'h', 'axis: y-axis']))
    // the mirrored strip sits around x = −1
    expect(
      ovs.some((o) => o.kind === 'path' && o.dashed && o.points.every((p) => p.x < -0.9 && p.x > -1.1)),
    ).toBe(true)
  })

  it('squares: the base s and a parallelogram offset up and to the right, plus faint slices', () => {
    const out = sectionOutline('square', 1, 0, 1)
    expect(out).toHaveLength(4)
    expect(out[2].x).toBeGreaterThan(1)
    expect(out[2].y).toBeGreaterThan(1)
    const link: VolumeLink = { ...LINK, parentId: 's', method: 'section', x: 2 }
    const ovs = volumeOverlays([link], [c.s], models)
    const sections = ovs.filter((o) => o.kind === 'path' && o.closed)
    expect(sections.length).toBeGreaterThanOrEqual(5)
    expect(ovs.some((o) => o.kind === 'segment' && o.from.x === 2 && o.to.x === 2)).toBe(true)
    // no mirror and no axis for a solid that is not revolved
    expect(ovs.some((o) => o.kind === 'hline')).toBe(false)
  })

  it('the slice handle rides the middle of the region, in x or in y', () => {
    const h = volumeSliceHandle({ ...LINK, otherId: 'g', a: 0, b: 1, x: 0.5 }, c.f, c.g, models)!
    expect(h.axis).toBe('x')
    near(h.pos.y, (0.5 + 0.25) / 2)
    const v = volumeSliceHandle({ ...LINK, otherId: 'g', a: 0, b: 1, axis: { dir: 'v', at: 0 }, x: 0.25 }, c.f, c.g, models)!
    expect(v.axis).toBe('y')
    expect(v.pos.y).toBe(0.25)
    near(v.pos.x, (0.25 + 0.5) / 2, 1e-9)
  })

  it('SAT: every volume mark in the one mono ink, the fills a light grey wash', () => {
    const sat = FIGURE_STYLES.sat
    const link: VolumeLink = { ...LINK, otherId: 'g', a: 0, b: 1, axis: { dir: 'h', at: 2 } }
    const ovs = overlaysFor([link], [c.f, c.g], models)
    const ctx = paint({ figure: sat, overlays: ovs }, models, [c.f, c.g])
    // nothing in either curve's screen colour
    expect(ctx.log.filter((e) => e.style === c.f.color || e.style === c.g.color)).toEqual([])
    // (the grid's own arrowheads are solid ink; every translucent fill is a wash)
    const fills = ctx.log.filter((e) => e.op === 'fill' && e.style === sat.theme.axis && e.alpha < 1)
    expect(fills.length).toBeGreaterThan(3)
    for (const f of fills) expect(f.alpha).toBeLessThanOrEqual(0.2)
    // the labels are text in the mono ink
    const chips = ctx.log.filter((e) => e.op === 'text' && (e.text === 'R' || e.text === 'r'))
    expect(chips).toHaveLength(2)
    for (const t of chips) expect(t.style).toBe(sat.theme.axis)
    // the axis y = 2 is a dashed line across the board
    const axis = ctx.log.find(
      (e) =>
        e.op === 'stroke' &&
        e.dash.length > 0 &&
        e.pts.length >= 2 &&
        e.pts.every((p) => 'y' in p && Math.abs((p as { y: number }).y - syOf(2)) < 1e-6),
    )
    expect(axis).toBeTruthy()
    void sxOf
  })

  it('on screen the curves keep their colours', () => {
    const link: VolumeLink = { ...LINK, parentId: 's' }
    const ctx = paint({ overlays: overlaysFor([link], [c.s], models) }, models, [c.s])
    expect(ctx.log.some((e) => e.style === c.s.color && e.op === 'fill')).toBe(true)
  })

  it('a board with no volume paints exactly what it did', () => {
    const a = paint({}, models, [c.s])
    const b = paint({ overlays: [] }, models, [c.s])
    expect(b.log.length).toBe(a.log.length)
  })
})

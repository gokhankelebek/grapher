// ============================================================================
// tests/volumeY.test.ts — known cross-sections perpendicular to the y-axis,
// and the representative slice's snapping.
//
// Worked by hand first:
//   y = √x and the x-axis on [0, 4], ⟂ y-axis: the horizontal slice at height
//   y ∈ [0, 2] runs from x = y² to x = 4, so w = 4 − y² and
//     squares      ∫₀² (4 − y²)² dy = ∫₀² (16 − 8y² + y⁴) dy = 32 − 64/3 + 32/5 = 256/15
//     semicircles  (π/8)·256/15 = 32π/15
//   y = x and y = x² on [0, 1], ⟂ y-axis: w = √y − y,
//     squares      ∫₀¹ (y − 2y^(3/2) + y²) dy = 1/2 − 4/5 + 1/3 = 1/30
// ============================================================================

import { describe, expect, it } from 'vitest'
import type { FittedCurve, ModelSpec } from '../src/core/types'
import { CURVE_COLORS } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { parseExpression } from '../src/core/parse'
import { calcLinkToStored, deserializeDoc, docFromBoard, serializeDoc, storedToCalcLink } from '../src/core/persist'
import type { BoardInput, CalcLink, DocMeta, VolumeLink } from '../src/core/persist'
import { exactVolume, horizontalBands, sectionVolume, sectionVolumeDy } from '../src/core/volume'
import type { Region } from '../src/core/volume'
import { changeLabel } from '../src/ui/calcLinks'
import {
  applyVolumeChange,
  modeOf,
  sectionOutline,
  sectionOutlineH,
  snapSlice,
  volumeOverlays,
  volumeRow,
  volumeSliceHandle,
} from '../src/ui/volumeLinks'

const curve = (id: string, modelId: string, params: number[]): FittedCurve => ({
  id,
  modelId,
  params,
  kind: 'explicit',
  domain: null,
  color: CURVE_COLORS[0],
  strokeWidth: 2.5,
  visible: true,
  error: 0,
})

function typed(lines: Record<string, string>): { c: Record<string, FittedCurve>; models: Record<string, ModelSpec> } {
  const c: Record<string, FittedCurve> = {}
  const models: Record<string, ModelSpec> = { ...MODELS }
  let i = 0
  for (const [id, src] of Object.entries(lines)) {
    const out = parseExpression(src)
    if (!out.ok) throw new Error(out.error)
    const mid = `expr_${++i}`
    models[mid] = out.plot.makeModel(mid)
    c[id] = curve(id, mid, out.plot.defaultParams.slice())
  }
  return { c, models }
}

const near = (v: number, want: number, rel = 1e-12): void => {
  expect(Math.abs(v - want)).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(want)))
}

const zero = (): number => 0
const reg = (f: (x: number) => number, g: (x: number) => number, a: number, b: number): Region => ({ f, g, a, b })

const LINK: VolumeLink = { kind: 'volume', id: 'V', parentId: 's', a: 0, b: 4, method: 'section' }
const LINK_Y: VolumeLink = { ...LINK, perp: 'y' }

describe('sectionVolumeDy — the numbers', () => {
  it('√x and the x-axis on [0, 4]: squares 256/15, semicircles 32π/15', () => {
    const r = reg(Math.sqrt, zero, 0, 4)
    const bands = horizontalBands(r)!
    expect(bands).not.toBeNull()
    const sq = sectionVolumeDy(r, bands, 'square')!
    near(sq.value, 256 / 15)
    expect(exactVolume(sq.value, sq.err)!.text).toBe('256/15')
    const semi = sectionVolumeDy(r, bands, 'semicircle')!
    near(semi.value, (32 * Math.PI) / 15)
    expect(exactVolume(semi.value, semi.err)!.text).toBe('32π/15')
    // a different solid from the ⟂ x-axis one (8)
    near(sectionVolume(r, 'square')!.value, 8)
  })

  it('y = x and y = x² on [0, 1]: squares 1/30', () => {
    const r = reg((x) => x, (x) => x * x, 0, 1)
    const v = sectionVolumeDy(r, horizontalBands(r)!, 'square')!
    near(v.value, 1 / 30)
    expect(exactVolume(v.value, v.err)!.text).toBe('1/30')
    near(sectionVolumeDy(r, horizontalBands(r)!, 'rectangle', 2)!.value, 2 / 30)
  })
})

describe('the card, ⟂ y-axis', () => {
  const { c, models } = typed({ f: 'y = x', g: 'y = x^2', s: 'y = sqrt(x)', p: 'y = x^2' })
  const sources = { f: 'y = x', g: 'y = x^2', s: 'y = sqrt(x)', p: 'y = x^2' }
  const row = (l: VolumeLink, parent: string, other?: string) =>
    volumeRow(l, c[parent], other ? c[other] : undefined, models, { fName: parent, gName: other ?? 'g', sources })

  it('squares on √x: ∫_0^2 (4 − y²)² dy = 256/15', () => {
    const r = row(LINK_Y, 's')
    expect(r.head).toBe('Squares ⟂ y-axis')
    expect(r.mode).toBe('section-y')
    expect(r.perp).toBe('y')
    expect(r.integral!.text).toBe('∫_0^2 (4 − y²)² dy')
    expect(r.integral!.tex).toContain('\\,dy')
    expect(r.parts).toEqual(['s(y) = 4 − y²', 'A(s) = s²'])
    expect(r.value).toBe('V = 256/15 ≈ 17.067')
    expect(r.need).toBeNull()
    expect(r.sliceVar).toBe('y')
    near(r.sliceLo, 0, 1e-9)
    near(r.sliceHi, 2, 1e-9)
  })

  it('semicircles on √x: (π/8)∫_0^2 (4 − y²)² dy = 32π/15', () => {
    const r = row({ ...LINK_Y, section: 'semicircle' }, 's')
    expect(r.head).toBe('Semicircles ⟂ y-axis')
    expect(r.integral!.text).toBe('(π/8)∫_0^2 (4 − y²)² dy')
    expect(r.value).toBe('V = 32π/15 ≈ 6.702')
  })

  it('between y = x and y = x²: ∫_0^1 (√y − y)² dy = 1/30', () => {
    const r = row({ ...LINK_Y, parentId: 'f', otherId: 'g', a: 0, b: 1 }, 'f', 'g')
    expect(r.integral!.text).toBe('∫_0^1 (√y − y)² dy')
    expect(r.value).toBe('V = 1/30 ≈ 0.033')
  })

  it('⟂ x-axis is unchanged', () => {
    const r = row(LINK, 's')
    expect(r.head).toBe('Squares ⟂ x-axis')
    expect(r.perp).toBe('x')
    expect(r.integral!.text).toBe('∫_0^4 (√x)² dx')
    expect(r.value).toBe('V = 8')
  })

  it('a region that is not one strip at every height says so, and offers ⟂ x-axis', () => {
    const r = row({ ...LINK_Y, parentId: 'p', a: -1, b: 2 }, 'p')
    expect(r.integral).toBeNull()
    expect(r.value).toBeNull()
    expect(r.problem).toBeNull()
    expect(r.need!.text).toMatch(/not one horizontal strip at every height/)
    expect(r.need!.button).toBe('Switch to ⟂ x-axis')
    expect(r.need!.change).toEqual({ kind: 'volumeSectionAxis', linkId: 'V', perp: 'x' })
    // and following it gives the ⟂ x-axis solid
    const back = applyVolumeChange(
      { ...LINK_Y, parentId: 'p', a: -1, b: 2 },
      { kind: 'volumeSectionAxis', linkId: 'V', perp: 'x' },
      { curves: [c.p], models, window: [-10, 10] },
    )!
    expect(back.perp).toBeUndefined()
    expect(row(back, 'p').integral!.text).toBe('∫_(−1)^2 (x²)² dx')
  })

  it('the dy pairings still offer their own switch', () => {
    const r = row({ kind: 'volume', id: 'V', parentId: 'p', a: -1, b: 2, method: 'washer', axis: { dir: 'v', at: 0 } }, 'p')
    expect(r.need!.switchTo).toBe('shell')
    expect(r.need!.button).toBe('Switch to shells')
    expect(r.need!.change).toEqual({ kind: 'volumeMethod', linkId: 'V', method: 'shell' })
  })
})

describe('the link in a file', () => {
  it('writes perp only for sections ⟂ y-axis; an old link is unchanged', () => {
    expect(calcLinkToStored(LINK)).toEqual({ kind: 'volume', id: 'V', parentId: 's', a: 0, b: 4, method: 'section' })
    expect(calcLinkToStored(LINK_Y)).toEqual({
      kind: 'volume', id: 'V', parentId: 's', a: 0, b: 4, method: 'section', perp: 'y',
    })
    // not a fact about a solid of revolution
    expect('perp' in calcLinkToStored({ ...LINK_Y, method: 'washer' })).toBe(false)
  })

  it('reads back what it wrote, and defaults what is junk', () => {
    const full: VolumeLink = { ...LINK_Y, otherId: 'g', section: 'semicircle', x: 1 }
    expect(storedToCalcLink(calcLinkToStored(full))).toEqual(full)
    expect(storedToCalcLink({ kind: 'volume', id: 'V', parentId: 's', a: 0, b: 4, method: 'section', perp: 'z' })).toEqual(LINK)
    expect(storedToCalcLink({ kind: 'volume', id: 'V', parentId: 's', a: 0, b: 4, perp: 'y' })).toEqual({
      ...LINK,
      method: 'washer',
    })
  })

  it('an old document round-trips byte-identical; a new one keeps perp', () => {
    const META: DocMeta = { id: 'doc1', name: 'Vol', createdAt: 1000, modifiedAt: 1000 }
    const { c } = typed({ s: 'y = sqrt(x)' })
    const board = (calc: CalcLink[]): BoardInput => ({
      curves: [c.s],
      styles: {},
      candidates: new Map(),
      exprSources: { s: 'y = sqrt(x)' },
      viewport: { center: { x: 0, y: 0 }, pxPerUnit: 60 },
      selectedId: null,
      mode: 'draw',
      calc,
    })
    const oldText = serializeDoc(docFromBoard(META, board([LINK]), 2000))
    expect(oldText).not.toContain('perp')
    const again = deserializeDoc(oldText)
    expect(serializeDoc(docFromBoard(META, { ...board([]), calc: again.board!.calc }, 2000))).toBe(oldText)
    const res = deserializeDoc(serializeDoc(docFromBoard(META, board([LINK_Y]), 2000)))
    expect(res.board!.calc).toEqual([LINK_Y])
  })
})

describe('switching the axis', () => {
  const { c, models } = typed({ s: 'y = sqrt(x)' })
  const ctx = { curves: [c.s], models, window: [-10, 10] as [number, number] }

  it('⟂ y drops the dx slice; ⟂ x drops perp; no-ops are null', () => {
    const y = applyVolumeChange({ ...LINK, x: 3 }, { kind: 'volumeSectionAxis', linkId: 'V', perp: 'y' }, ctx)!
    expect(y).toEqual(LINK_Y)
    expect(modeOf(y)).toBe('section-y')
    const x = applyVolumeChange({ ...y, x: 1 }, { kind: 'volumeSectionAxis', linkId: 'V', perp: 'x' }, ctx)!
    expect(x).toEqual(LINK)
    expect(applyVolumeChange(LINK_Y, { kind: 'volumeSectionAxis', linkId: 'V', perp: 'y' }, ctx)).toBeNull()
    expect(applyVolumeChange(LINK, { kind: 'volumeSectionAxis', linkId: 'V', perp: 'x' }, ctx)).toBeNull()
  })

  it('from washers, ⟂ y-axis means sections; a new method drops perp; a new shape keeps it', () => {
    const w: VolumeLink = { ...LINK, method: 'washer' }
    expect(applyVolumeChange(w, { kind: 'volumeSectionAxis', linkId: 'V', perp: 'y' }, ctx)).toEqual(LINK_Y)
    const off = applyVolumeChange(LINK_Y, { kind: 'volumeMethod', linkId: 'V', method: 'washer' }, ctx)!
    expect(off.perp).toBeUndefined()
    const semi = applyVolumeChange(LINK_Y, { kind: 'volumeSection', linkId: 'V', section: 'semicircle' }, ctx)!
    expect(semi.perp).toBe('y')
  })

  it('has an undo label', () => {
    expect(changeLabel({ kind: 'volumeSectionAxis', linkId: 'V', perp: 'y' })).toBe('change cross-section axis')
  })
})

describe('the figure, ⟂ y-axis', () => {
  const { c, models } = typed({ s: 'y = sqrt(x)' })

  it('the base is horizontal at height y, from x = y² to x = 4, with the section on it', () => {
    const ovs = volumeOverlays([{ ...LINK_Y, x: 1 }], [c.s], models)
    const base = ovs.find((o) => o.kind === 'segment' && o.from.y === 1 && o.to.y === 1)
    expect(base).toBeDefined()
    if (base && base.kind === 'segment') {
      near(base.from.x, 1, 1e-9)
      near(base.to.x, 4, 1e-9)
    }
    const closed = ovs.filter((o) => o.kind === 'path' && o.closed)
    expect(closed.length).toBeGreaterThanOrEqual(4) // the section and ghost slices
    expect(ovs.some((o) => o.kind === 'label' && o.text === 's')).toBe(true)
    // not revolved: no mirror, no axis
    expect(ovs.some((o) => o.kind === 'hline')).toBe(false)
    expect(ovs.some((o) => o.kind === 'label' && o.text.startsWith('axis:'))).toBe(false)
  })

  it('sectionOutlineH is sectionOutline turned: a square leans up and right off a horizontal base', () => {
    const sq = sectionOutlineH('square', 1, 0, 2)
    expect(sq).toHaveLength(4)
    expect(sq[0]).toEqual({ x: 0, y: 1 })
    expect(sq[1]).toEqual({ x: 2, y: 1 })
    expect(sq[2].x).toBeGreaterThan(2)
    expect(sq[2].y).toBeGreaterThan(1)
    const semi = sectionOutlineH('semicircle', 0, -1, 1)
    near(semi[0].x, -1, 1e-12)
    near(semi[semi.length - 1].x, 1, 1e-12)
    for (const p of semi) expect(p.y).toBeGreaterThanOrEqual(-1e-12)
    // the vertical one is what it always was
    expect(sectionOutline('square', 1, 0, 1)[1]).toEqual({ x: 1, y: 1 })
  })

  it('the slice handle drags in y, riding the middle of the horizontal slice', () => {
    const h = volumeSliceHandle({ ...LINK_Y, x: 1 }, c.s, undefined, models)!
    expect(h.axis).toBe('y')
    expect(h.pos.y).toBe(1)
    near(h.pos.x, (1 + 4) / 2, 1e-9)
    near(h.lo, 0, 1e-9)
    near(h.hi, 2, 1e-9)
  })
})

describe('snapSlice — the slice handle snaps, then stays in the region', () => {
  const grid = (v: number): number => Math.round(v * 4) / 4

  it('snaps to the board’s nice values', () => {
    expect(snapSlice(1.13, 0, 4, grid)).toBe(1.25)
    expect(snapSlice(2.9, 0, 4, grid)).toBe(3)
  })

  it('clamps after snapping', () => {
    expect(snapSlice(4.1, 0, 4, grid)).toBe(4)
    expect(snapSlice(-0.4, 0, 4, grid)).toBe(0)
    expect(snapSlice(1.99, 0, 1.9, grid)).toBe(1.9)
  })

  it('a snap that fails leaves the raw value, clamped', () => {
    expect(snapSlice(1.13, 0, 4, () => Number.NaN)).toBe(1.13)
    expect(
      snapSlice(9, 0, 4, () => {
        throw new Error('no')
      }),
    ).toBe(4)
  })
})

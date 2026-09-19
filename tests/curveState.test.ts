// ============================================================================
// tests/curveState.test.ts — the three questions the card and the toolbar ask.
//
// Each one exists because a reviewer measured the answer being wrong:
//   • a midline of 0.0005 printed as "5.09e-4" beside a wave of height 6.5,
//     because nobody passed formatCoord the scale it asks for;
//   • a column of coefficients that did not line up on the decimal point;
//   • "fit to curves" had no idea where a curve was, because nothing knew.
// ============================================================================

import { describe, it, expect } from 'vitest'
import type { FittedCurve } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { formatCoord } from '../src/ui/numeric'
import {
  alignedValues,
  curveBounds,
  curveScale,
  derivesFromInk,
  splitNotice,
  unionBoxes,
} from '../src/ui/curveState'

function curve(modelId: string, params: number[], over: Partial<FittedCurve> = {}): FittedCurve {
  return {
    id: 'c1',
    modelId,
    params: params.slice(),
    kind: MODELS[modelId].kind,
    domain: null,
    color: '#4f9cf9',
    strokeWidth: 2.5,
    visible: true,
    error: 0.01,
    ...over,
  }
}

describe('curveScale — how big is this curve', () => {
  it('measures a sine by its own height', () => {
    // y = 3.25·sin(x) + 0 spans 6.5
    const s = curveScale(curve('sine', [3.25, 1, 0, 0]), MODELS.sine)
    expect(s).toBeGreaterThan(6)
    expect(s).toBeLessThan(7)
  })

  it('is the scale that makes a tiny midline read as the zero it is', () => {
    // The exact case from the review: a midline of 5.09e-4 on a wave of 6.5.
    const wave = curve('sine', [3.25, 1, 0, 5.09e-4])
    const scale = curveScale(wave, MODELS.sine)
    expect(formatCoord(5.09e-4, { scale, exact: false })).toBe('0')
    // and the card is not simply swallowing small numbers: on a curve that is
    // itself that small, the same value is the whole figure
    const flat = curve('sine', [5.09e-4, 1, 0, 0])
    expect(formatCoord(5.09e-4, { scale: curveScale(flat, MODELS.sine), exact: false })).not.toBe(
      '0',
    )
  })

  it('falls back to the horizontal run when the curve is flat', () => {
    const line = curve('line', [3, 0]) // y = 3
    expect(curveScale(line, MODELS.line)).toBeGreaterThan(0)
  })

  it('never throws on a family it cannot sample', () => {
    expect(curveScale(curve('poly3', [0, 0, 0, 1]), undefined)).toBeUndefined()
  })
})

describe('curveBounds — where does it live', () => {
  it('boxes a parabola over the window it is asked about', () => {
    const box = curveBounds(curve('poly2', [0, 0, 1]), MODELS.poly2, [-2, 2])
    expect(box).not.toBeNull()
    expect(box!.min.x).toBeCloseTo(-2, 6)
    expect(box!.max.x).toBeCloseTo(2, 6)
    expect(box!.min.y).toBeCloseTo(0, 6)
    expect(box!.max.y).toBeCloseTo(4, 6)
  })

  it("honours a curve's own domain over the caller's window", () => {
    const box = curveBounds(curve('line', [0, 1], { domain: [0, 1] }), MODELS.line, [-50, 50])
    expect(box!.min.x).toBeCloseTo(0, 6)
    expect(box!.max.x).toBeCloseTo(1, 6)
  })

  it('boxes a circle, which has no parameterisation to walk, from its ink', () => {
    const ink = [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 0, y: -1 },
    ]
    const box = curveBounds(curve('circle', [0, 0, 1], { sourceStroke: ink }), MODELS.circle)
    expect(box).toEqual({ min: { x: -1, y: -1 }, max: { x: 1, y: 1 } })
  })

  it('leaves out what it cannot measure rather than inventing a box', () => {
    expect(curveBounds(curve('circle', [0, 0, 1]), MODELS.circle)).toBeNull()
  })

  it('unions the boxes that exist and ignores the ones that do not', () => {
    const a = curveBounds(curve('line', [0, 1], { domain: [0, 1] }), MODELS.line)
    const b = curveBounds(curve('line', [0, 1], { domain: [4, 5] }), MODELS.line)
    const box = unionBoxes([a, null, b])
    expect(box!.min.x).toBeCloseTo(0, 6)
    expect(box!.max.x).toBeCloseTo(5, 6)
    expect(unionBoxes([null, null])).toBeNull()
  })
})

describe('alignedValues — a column that lines up on the point', () => {
  it('gives every row in a group the same number of decimals', () => {
    const out = alignedValues([0.65, -0.5, -1.25, 1.5])
    expect(out).toEqual(['0.6500', '−0.5000', '−1.2500', '1.5000'])
    const widths = new Set(out.map((t) => t.split('.')[1].length))
    expect(widths.size).toBe(1)
  })

  it('spends its digits on the magnitude in the group, not on each row', () => {
    // Three decimals keeps four significant digits on the SMALLEST value in
    // the group; the largest simply comes along, still on the same point.
    const out = alignedValues([1234.5, 2.25])
    expect(out).toEqual(['1234.500', '2.250'])
  })

  it('uses a real minus sign and never prints a negative zero', () => {
    expect(alignedValues([-1e-15, 2])).toEqual(['0.000', '2.000'])
  })

  it("reports a value below the curve's own resolution as zero", () => {
    expect(alignedValues([5.09e-4, 3.25], 6.5)[0]).toBe('0.000')
  })

  it('opts the group out when a value needs exponential notation', () => {
    const out = alignedValues([1e-9, 2])
    expect(out[0]).toContain('e')
  })

  it('survives a non-finite value', () => {
    expect(alignedValues([NaN, 1])[0]).toBe('—')
  })
})

describe('derivesFromInk — is σ still a fact about this curve', () => {
  const ink = [{ x: 0, y: 0 }]

  it('is true for a fresh sketch', () => {
    expect(derivesFromInk(curve('poly2', [0, 0, 1], { sourceStroke: ink }), false)).toBe(true)
  })

  it('is false the moment the curve has been edited', () => {
    expect(derivesFromInk(curve('poly2', [0, 0, 1], { sourceStroke: ink }), true)).toBe(false)
  })

  it('is false for a typed expression, which never had ink', () => {
    expect(derivesFromInk(curve('poly2', [0, 0, 1], { modelId: 'expr_1' }), false)).toBe(false)
    expect(derivesFromInk(curve('poly2', [0, 0, 1]), false)).toBe(false)
  })
})

describe('splitNotice — the stage says Undo, the board means it', () => {
  it('turns the tail into an offer and keeps the sentence', () => {
    expect(splitNotice('Blended into this curve · Undo')).toEqual({
      msg: 'Blended into this curve',
      undoable: true,
    })
  })

  it('leaves a plain notice alone', () => {
    expect(splitNotice('Couldn’t blend that stroke')).toEqual({
      msg: 'Couldn’t blend that stroke',
      undoable: false,
    })
  })

  it('does not strip the word undo out of the middle of a sentence', () => {
    const t = 'Undo brings the cubic back'
    expect(splitNotice(t)).toEqual({ msg: t, undoable: false })
  })
})

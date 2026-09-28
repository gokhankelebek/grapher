import { describe, expect, it } from 'vitest'
import { logisticAt, logisticSource, logisticValues, readLogistic, type LogisticSpec } from '../src/core/logistic'
import {
  commitLogisticSpec,
  defaultForm,
  dragLogisticHandle,
  fittedLogistic,
  logisticAsymptotes,
  logisticDot,
  logisticFactLines,
  logisticFieldPlan,
  logisticFieldValues,
  logisticHandles,
  logisticMarks,
  logisticPreview,
  logisticProblems,
  safeReadLogistic,
  setLogisticField,
  specFromLogisticDraft,
  withLogisticMarks,
  withMidpoint,
} from '../src/ui/logisticLinks'
import { readField } from '../src/ui/fieldLinks'
import type { SpecialPoint } from '../src/core/types'

const BC = 'y = 1000/(1 + 49e^(-0.3x))'
const bc = (): LogisticSpec => readLogistic(BC)!

describe('the builder: L, k, y(0)', () => {
  it('P(0) = 20, L = 1000, k = 0.3 writes A = 49', () => {
    const r = specFromLogisticDraft({ L: '1000', k: '0.3', y0: '20', d: '0', v: 'x' })
    expect(r.error).toBeNull()
    expect(logisticSource(r.spec!)).toBe(BC)
    const p = logisticPreview(r.spec)
    expect(p.src).toBe(BC)
    expect(p.latex).toContain('\\frac{1000}')
    expect(p.facts.join('\n')).toMatch(/Maximum growth rate L·k\/4 = 75/)
    expect(p.deTex).toContain('\\frac{dy}{dx}')
  })

  it('in t, with a shift', () => {
    const r = specFromLogisticDraft({ L: '10', k: '0.5', y0: '5', d: '2', v: 't' })
    expect(logisticSource(r.spec!)).toBe('y = 10/(1 + (7/3)e^(-0.5t)) + 2')
    expect(logisticAt(r.spec!, 0)).toBeCloseTo(5, 12)
  })

  it('names the field that is wrong, and the equilibrium refusals', () => {
    expect(specFromLogisticDraft({ L: '', k: '0.3', y0: '20', d: '0', v: 'x' }).error).toMatch(/carrying capacity L is empty/)
    expect(specFromLogisticDraft({ L: '1000', k: 'x', y0: '20', d: '0', v: 'x' }).error).toMatch(/growth constant k “x” is not a number/)
    expect(specFromLogisticDraft({ L: '1000', k: '0.3', y0: '1200', d: '0', v: 'x' }).error).toMatch(/beyond the carrying capacity/)
  })
})

describe('the card: vocabularies and fact lines', () => {
  it('opens in AP Calc, or Precalc for a shifted line', () => {
    expect(defaultForm(bc())).toBe('ap')
    expect(defaultForm(readLogistic('y = 10/(1 + 3e^(-0.5x)) + 2')!)).toBe('precalc')
  })

  it('AP Calc lines', () => {
    const lines = logisticFactLines(bc(), 'ap')
    expect(lines).toContain('Carrying capacity L = 1000')
    expect(lines).toContain('Horizontal asymptotes y = 0 and y = 1000')
    expect(lines).toContain('Inflection point ((20/3) ln 7 ≈ 12.97, 500): fastest growth')
    expect(lines).toContain('Maximum growth rate L·k/4 = 75')
    expect(lines).toContain('Initial value y(0) = 20')
  })

  it('Precalc lines', () => {
    const lines = logisticFactLines(readLogistic('y = 10/(1 + 3e^(-0.5x)) + 2')!, 'precalc')
    expect(lines).toContain('Horizontal asymptotes y = d = 2 and y = a + d = 12')
    expect(lines).toContain('Range: 2 < y < 12')
    expect(lines).toContain('Increasing; concave up for x < 2.197, concave down for x > 2.197')
    expect(lines).toContain('As x → −∞, y → 2; as x → ∞, y → 12')
    const dec = logisticFactLines(readLogistic('y = 10/(1 + e^(x))')!, 'precalc')
    expect(dec).toContain('Decreasing; concave down for x < 0, concave up for x > 0')
  })

  it('field values: x0 and y(0) are derived; a midpoint form shows its own shift', () => {
    const v = logisticFieldValues(bc())
    expect(v.L).toBe('1000')
    expect(v.A).toBe('49')
    expect(v.y0).toBe('20')
    expect(Number(v.x0)).toBeCloseTo(Math.log(49) / 0.3, 4)
    expect(logisticFieldValues(readLogistic('y = 10/(1 + e^(-2(x - 3)))')!).x0).toBe('3')
  })
})

describe('one committed edit', () => {
  const restate = (out: string[]) => ({ restate: (src: string) => (out.push(src), null) })

  it('L, k, A, d are retyped as they are', () => {
    const out: string[] = []
    expect(commitLogisticSpec(bc(), setLogisticField(bc(), 'L', '500'), 'set', restate(out))).toBeNull()
    expect(out[0]).toBe('y = 500/(1 + 49e^(-0.3x))')
    commitLogisticSpec(bc(), setLogisticField(bc(), 'd', '5'), 'set', restate(out))
    expect(out[1]).toBe('y = 1000/(1 + 49e^(-0.3x)) + 5')
    commitLogisticSpec(bc(), setLogisticField(bc(), 'k', '0.5'), 'set', restate(out))
    expect(out[2]).toBe('y = 1000/(1 + 49e^(-0.5x))')
  })

  it('y(0) re-solves A; x0 re-solves A or moves the midpoint form', () => {
    expect(logisticSource(setLogisticField(bc(), 'y0', '100')!)).toBe('y = 1000/(1 + 9e^(-0.3x))')
    const moved = setLogisticField(bc(), 'x0', '10')!
    expect(logisticValues(moved)!.x0).toBeCloseTo(10, 4)
    expect(logisticSource(setLogisticField(readLogistic('y = 10/(1 + e^(-2(x - 3)))')!, 'x0', '5')!)).toBe(
      'y = 10/(1 + e^(-2(x - 5)))',
    )
  })

  it('refuses what is not a logistic', () => {
    const noop = { restate: () => null }
    expect(commitLogisticSpec(bc(), setLogisticField(bc(), 'A', '-2'), 'set', noop)).toMatch(/A must be positive/)
    expect(commitLogisticSpec(bc(), setLogisticField(bc(), 'L', '0'), 'set', noop)).toMatch(/L can’t be 0/)
    expect(commitLogisticSpec(bc(), setLogisticField(bc(), 'y0', '2000'), 'set', noop)).toMatch(/can’t be written/)
    expect(logisticProblems({ L: '1', k: '0', A: '1', h: '0', d: '0' })[0].message).toMatch(/constant/)
  })

  it('retyping k on a base form states it with base e', () => {
    const s = readLogistic('y = 10/(1 + 3*2^(-x))')!
    expect(logisticSource(setLogisticField(s, 'k', '0.7')!)).toBe('y = 10/(1 + 3e^(-0.7x))')
    expect(logisticSource(setLogisticField(s, 'b', '3')!)).toBe('y = 10/(1 + 3(3)^(-x))')
  })
})

describe('handles', () => {
  it('three handles: the inflection, the carrying capacity at the right edge, the lower asymptote at the left', () => {
    const hs = logisticHandles(bc())
    expect(hs.map((h) => h.which)).toEqual(['mid', 'L', 'd'])
    expect(hs[0].pos.x).toBeCloseTo(Math.log(49) / 0.3, 9)
    expect(hs[0].pos.y).toBe(500)
    expect(hs[1]).toMatchObject({ edge: 'right', pos: { y: 1000 } })
    expect(hs[2]).toMatchObject({ edge: 'left', pos: { y: 0 } })
    // a decreasing S approaches its upper asymptote on the left
    const dec = logisticHandles(readLogistic('y = 10/(1 + e^x)')!)
    expect(dec[1].edge).toBe('left')
  })

  it('dragging the inflection moves the whole S: same L and k, new x0 and d', () => {
    const next = dragLogisticHandle(bc(), 'mid', { x: 10, y: 600 })!
    const v = logisticValues(next)!
    expect(v.x0).toBeCloseTo(10, 4)
    expect(v.L).toBe(1000)
    expect(v.k).toBe(0.3)
    expect(v.d).toBe(100)
    expect(v.L / 2 + v.d).toBe(600)
  })

  it('dragging the midpoint form moves its shift exactly', () => {
    const s = readLogistic('y = 10/(1 + e^(-2(x - 3)))')!
    expect(logisticSource(dragLogisticHandle(s, 'mid', { x: 4, y: 5 })!)).toBe('y = 10/(1 + e^(-2(x - 4)))')
  })

  it('dragging the carrying capacity stretches: d and x0 kept', () => {
    const next = dragLogisticHandle(bc(), 'L', { x: 0, y: 800 })!
    expect(logisticSource(next)).toBe('y = 800/(1 + 49e^(-0.3x))')
    expect(logisticValues(next)!.x0).toBeCloseTo(logisticValues(bc())!.x0, 12)
  })

  it('dragging the lower asymptote keeps the upper one', () => {
    const next = dragLogisticHandle(bc(), 'd', { x: 0, y: 200 })!
    const v = logisticValues(next)!
    expect(v.d).toBe(200)
    expect(v.L + v.d).toBe(1000)
    expect(logisticSource(next)).toBe('y = 800/(1 + 49e^(-0.3x)) + 200')
  })

  it('an asymptote dragged onto or past the other one is refused', () => {
    expect(dragLogisticHandle(bc(), 'L', { x: 0, y: 0 })).toBeNull()
    expect(dragLogisticHandle(bc(), 'L', { x: 0, y: -50 })).toBeNull()
    expect(dragLogisticHandle(bc(), 'd', { x: 0, y: 1000 })).toBeNull()
    expect(dragLogisticHandle(bc(), 'd', { x: 0, y: 1200 })).toBeNull()
  })

  it('a base form keeps its base when the inflection moves', () => {
    const s = readLogistic('y = 10/(1 + 3*2^(-x))')!
    const next = withMidpoint(s, 3)!
    expect(next.b).toBe('2')
    expect(next.A).toBe('8')
  })
})

describe('on screen', () => {
  it('two dashed asymptotes and a labelled dot', () => {
    const lines = logisticAsymptotes(bc(), '#f00', 'lg')
    expect(lines.map((l) => l.pts[0].y)).toEqual([0, 1000])
    expect(lines.every((l) => l.dash && l.dash.length === 2)).toBe(true)
    const dot = logisticDot(bc(), '#f00', 'lg:dot')
    expect(dot[0]).toMatchObject({ kind: 'point', label: 'fastest growth', at: { y: 500 } })
  })

  it('the analysis inflection takes the exact coordinates in place', () => {
    const marks = logisticMarks(bc())
    expect(marks[0]).toMatchObject({ kind: 'inflection', exactX: '(20/3) ln 7', exactY: '500' })
    const found: SpecialPoint = {
      kind: 'inflection',
      pos: { x: Math.log(49) / 0.3 + 1e-9, y: 500 },
      label: 'inflection',
      exact: false,
    }
    const zero: SpecialPoint = { kind: 'zero', pos: { x: -40, y: 0 }, label: 'zero', exact: false }
    const merged = withLogisticMarks([zero, found], marks)
    expect(merged.length).toBe(2)
    expect(merged[1].exactX).toBe('(20/3) ln 7')
    expect(withLogisticMarks([zero], marks).length).toBe(2)
  })
})

describe('Show slope field', () => {
  it('the field parses, and its solution through (0, y(0)) is the curve', () => {
    const plan = logisticFieldPlan(bc())!
    expect(plan.src).toBe('dy/dx = 0.3*y*(1 - y/1000)')
    expect(plan.through).toEqual({ x: 0, y: expect.closeTo(20, 10) })
    const f = readField(plan.src)
    expect(f.ok).toBe(true)
  })

  it('a shifted logistic gets the shifted equation', () => {
    const plan = logisticFieldPlan(readLogistic('y = 10/(1 + 3e^(-0.5x)) + 2')!)!
    expect(plan.src).toBe('dy/dx = 0.5*(y - 2)*(1 - (y - 2)/10)')
    expect(readField(plan.src).ok).toBe(true)
  })
})

describe('a sketched logistic', () => {
  it('is stated the AP way to four digits and converts to a typed line', () => {
    const f = fittedLogistic([4.0012, 1.6, 0.5, -1.00003])!
    expect(f.spec.L).toBe('4.001')
    expect(f.spec.k).toBe('1.6')
    expect(f.spec.d).toBe('-1')
    expect(f.src).toMatch(/^y = 4\.001\/\(1 \+ 2\.226e\^\(-1\.6x\)\) - 1$/)
    expect(safeReadLogistic(f.src)).not.toBeNull()
    expect(fittedLogistic([0, 1, 0, 0])).toBeNull()
  })
})

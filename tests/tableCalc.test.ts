// ============================================================================
// tests/tableCalc.test.ts — calculus on a data table (AP 2.1/2.3, 6.2/6.3, 8.1,
// IVT / MVT reasoning on tables).
//
// Every number below is computed by hand in the comment beside it:
//   - unequal-width L, R, M and T sums, on whole tables and on sub-ranges;
//   - the Σ form and the terms as the card writes them;
//   - units from the headers ("t (min)", "r(t) (gal/min)" → gallons);
//   - the difference quotient between rows, at a row, at either end;
//   - the average value as a trapezoidal sum over b − a;
//   - the IVT and MVT, stated only when the hypothesis is granted;
//   - an unsorted table ("Sort by x") and a repeated x;
//   - persistence (only what was set; old documents byte-identical);
//   - reveal masking, the student copy, describeGraph, the exports;
//   - the two gallery examples' numbers, as their notes state them.
// ============================================================================

import { describe, expect, it } from 'vitest'
import type { FitResult } from '../src/core/types'
import { DARK_THEME } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import type { BoardData, BoardInput, DocMeta, StoredDoc } from '../src/core/persist'
import { deserializeDoc, docFromBoard, normalizeTableCalc, serializeDoc } from '../src/core/persist'
import {
  cellText,
  derivativeUnit,
  integralUnit,
  numOfCell,
  qDecimal,
  qParse,
  splitLabel,
  tableAverage,
  tableDerivative,
  tableIvt,
  tableMvt,
  tableNames,
  tableSum,
  valueText,
} from '../src/core/tableCalc'
import type { TablePt } from '../src/core/tableCalc'
import {
  readTable,
  sortRowsByX,
  tableCalcAnswer,
  tableCalcCard,
  tableCalcKeys,
  tableCalcOverlays,
  tableCalcSentences,
  turnOff,
  turnOn,
  typedNum,
} from '../src/ui/tableCalcLinks'
import { REVEAL_OFF, applyReveal, buildInventory, isHidden, revealOne, tableCalcKey } from '../src/ui/reveal'
import type { RevealState, SceneReveal } from '../src/ui/reveal'
import type { BoardScene } from '../src/ui/renderBoard'
import { docFigure, docModelFromJSON, recordFigure } from '../src/ui/docScene'
import { describeBoard } from '../src/ui/boardDescription'
import { dataBox } from '../src/ui/dataLinks'
import { answerLine } from '../src/ui/revealedAnswers'
import { toTikz } from '../src/render/vectorTikz'
import { toPgfplots } from '../src/ui/pgfplotsExport'
import { COMMANDS, COMMAND_BY_ID, HELP_SECTIONS } from '../src/ui/commands'
import type { CommandActions, CommandContext } from '../src/ui/commands'
import { buildExample, exampleById } from '../src/examples'

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

/** Rows as points, the way readTable reads them (exact where the text is a plain rational). */
function pts(rows: [string, string][]): TablePt[] {
  return rows.map(([x, y]) => {
    const xn = numOfCell(x, Number(x))
    const yn = numOfCell(y, Number(y))
    return { x: xn, y: yn, xText: cellText(x, xn), yText: cellText(y, yn) }
  })
}

const TANK: [string, string][] = [
  ['0', '4.3'],
  ['2', '5.0'],
  ['5', '5.9'],
  ['9', '7.1'],
  ['12', '8.4'],
]
const TANK_NAMES = tableNames('t (min)', 'r(t) (gal/min)')
const tank = pts(TANK)

function table(rows: [string, string][], over: Partial<BoardData> = {}): BoardData {
  return {
    id: 'T1',
    name: 'Table 1',
    xLabel: 't (min)',
    yLabel: 'r(t) (gal/min)',
    rows: rows.map(([x, y]) => ({ x, y })),
    color: '#4f9cf9',
    visible: true,
    regressions: [],
    ...over,
  }
}

const sumOf = (p: TablePt[], i: number, j: number, m: 'left' | 'right' | 'midpoint' | 'trapezoid') => {
  const r = tableSum(p, i, j, m, TANK_NAMES)
  if (!r.ok) throw new Error(r.why)
  return r
}

// ---------------------------------------------------------------------------
// exact arithmetic
// ---------------------------------------------------------------------------

describe('exact rationals from table text', () => {
  it('reads decimals, fractions, signs, exponents and spreadsheet commas exactly', () => {
    expect(qParse('4.3')).toEqual({ n: 43n, d: 10n })
    expect(qParse('5.0')).toEqual({ n: 5n, d: 1n })
    expect(qParse('−0.25')).toEqual({ n: -1n, d: 4n })
    expect(qParse('3/4')).toEqual({ n: 3n, d: 4n })
    expect(qParse('1e3')).toEqual({ n: 1000n, d: 1n })
    expect(qParse('1,234.5')).toEqual({ n: 2469n, d: 2n })
    expect(qParse('2,25')).toEqual({ n: 9n, d: 4n })
    expect(qParse('2pi')).toBeNull()
    expect(qParse('')).toBeNull()
  })
  it('prints a terminating value as its decimal, any other as its fraction and to three places', () => {
    expect(qDecimal({ n: 137n, d: 2n })).toBe('68.5')
    expect(qDecimal({ n: 1n, d: 3n })).toBeNull()
    expect(valueText(numOfCell('68.5', 68.5)).rhs).toBe('= 68.5')
    // 749/120 = 6.241666… → 6.242
    expect(valueText({ v: 749 / 120, q: { n: 749n, d: 120n } }).rhs).toBe('= 749/120 ≈ 6.242')
    // a float result says ≈ and three places
    expect(valueText({ v: Math.PI, q: null }).rhs).toBe('≈ 3.142')
  })
  it('never accumulates float error: 0.1 + 0.2 is 0.3', () => {
    const p = pts([['0', '0.1'], ['1', '0.2'], ['2', '0']])
    // L₂ = (1)(0.1) + (1)(0.2) = 0.3 exactly (in floats it would be 0.30000000000000004)
    const r = tableSum(p, 0, 2, 'left', TANK_NAMES)
    expect(r.ok && r.result.rhs).toBe('= 0.3')
  })
})

// ---------------------------------------------------------------------------
// headers → names and units
// ---------------------------------------------------------------------------

describe('names and units from the headers', () => {
  it('splits a header into its name and unit', () => {
    expect(splitLabel('t (min)')).toEqual({ name: 't', unit: 'min' })
    expect(splitLabel('r(t) (gal/min)')).toEqual({ name: 'r(t)', unit: 'gal/min' })
    expect(splitLabel('r(t)')).toEqual({ name: 'r(t)', unit: null })
    expect(splitLabel('Time [s]')).toEqual({ name: 'Time', unit: 's' })
    expect(splitLabel('Time(min)')).toEqual({ name: 'Time', unit: 'min' })
    expect(splitLabel('y')).toEqual({ name: 'y', unit: null })
  })
  it('reads the function letter and its variable', () => {
    expect(TANK_NAMES).toMatchObject({ fn: 'r', arg: 't', xUnit: 'min', yUnit: 'gal/min' })
    expect(tableNames('x', 'y')).toMatchObject({ fn: 'f', arg: 'x', intUnit: null, derivUnit: null })
    expect(tableNames('t', 'v')).toMatchObject({ fn: 'v', arg: 't' })
    expect(tableNames('Year', 'Population')).toMatchObject({ fn: 'f', arg: 'x' })
  })
  it('works the units of ∫ r dt and of r′', () => {
    expect(TANK_NAMES.intUnit).toBe('gallons')
    expect(TANK_NAMES.derivUnit).toBe('gal/min per min')
    expect(integralUnit('ft/sec', 'sec')).toBe('feet')
    expect(integralUnit('people per hour', 'hours')).toBe('people')
    expect(integralUnit('L/min', 'minutes')).toBe('liters')
    expect(integralUnit('N', 'm')).toBe('N·m')
    expect(derivativeUnit('ft', 's')).toBe('ft/s')
    expect(derivativeUnit('ft/sec', 'sec')).toBe('ft/sec per sec')
  })
})

// ---------------------------------------------------------------------------
// sums
// ---------------------------------------------------------------------------

describe('Riemann and trapezoidal sums with unequal widths', () => {
  it('the tank table: L₄, R₄ and T₄ by hand', () => {
    // widths 2, 3, 4, 3
    // L₄ = 2(4.3) + 3(5.0) + 4(5.9) + 3(7.1) = 8.6 + 15 + 23.6 + 21.3 = 68.5
    // R₄ = 2(5.0) + 3(5.9) + 4(7.1) + 3(8.4) = 10 + 17.7 + 28.4 + 25.2 = 81.3
    // T₄ = ½·2·9.3 + ½·3·10.9 + ½·4·13.0 + ½·3·15.5 = 9.3 + 16.35 + 26 + 23.25 = 74.9 = (L₄ + R₄)/2
    expect(sumOf(tank, 0, 4, 'left').result.rhs).toBe('= 68.5')
    expect(sumOf(tank, 0, 4, 'right').result.rhs).toBe('= 81.3')
    expect(sumOf(tank, 0, 4, 'trapezoid').result.rhs).toBe('= 74.9')
    expect(sumOf(tank, 0, 4, 'trapezoid').n).toBe(4)
  })
  it('a sub-range [2, 9]: L₂, R₂, T₂', () => {
    // L₂ = 3(5.0) + 4(5.9) = 15 + 23.6 = 38.6; R₂ = 3(5.9) + 4(7.1) = 17.7 + 28.4 = 46.1; T₂ = 42.35
    expect(sumOf(tank, 1, 3, 'left').text).toBe('L₂ = (3)(5.0) + (4)(5.9) = 38.6')
    expect(sumOf(tank, 1, 3, 'right').result.short).toBe('46.1')
    expect(sumOf(tank, 1, 3, 'trapezoid').result.short).toBe('42.35')
  })
  it('a midpoint sum pairs the gaps and samples the middle row, unequal widths too', () => {
    // t = 0, 1, 2, 5, 8 and v = 3, 4, 6, 2, 1: [0, 2] has midpoint 1, [2, 8] has midpoint 5
    // M₂ = (2)(4) + (6)(2) = 8 + 12 = 20
    // L₄ = 1·3 + 1·4 + 3·6 + 3·2 = 31; R₄ = 1·4 + 1·6 + 3·2 + 3·1 = 19; T₄ = 25
    const p = pts([['0', '3'], ['1', '4'], ['2', '6'], ['5', '2'], ['8', '1']])
    const m = sumOf(p, 0, 4, 'midpoint')
    expect(m.text).toBe('M₂ = (2)(4) + (6)(2) = 20')
    expect(m.pieces).toEqual([
      { x0: 0, x1: 2, h0: 4, h1: 4 },
      { x0: 2, x1: 8, h0: 2, h1: 2 },
    ])
    expect(m.widthsText).toBe('Δt₁ = 2, Δt₂ = 6, t̄₁ = 1, t̄₂ = 5')
    expect(sumOf(p, 0, 4, 'left').result.short).toBe('31')
    expect(sumOf(p, 0, 4, 'right').result.short).toBe('19')
    expect(sumOf(p, 0, 4, 'trapezoid').result.short).toBe('25')
  })
  it('says why a midpoint sum is unavailable: an odd number of gaps, or a midpoint that is not a row', () => {
    const odd = tableSum(tank, 1, 4, 'midpoint', TANK_NAMES)
    expect(odd.ok).toBe(false)
    expect(!odd.ok && odd.why).toContain('this interval has 3')
    const off = tableSum(tank, 0, 4, 'midpoint', TANK_NAMES)
    expect(!off.ok && off.why).toBe(
      'Unavailable: the midpoint of [0, 5] is 2.5, which is not in the table (the row between them has t = 2). A midpoint sum needs every subinterval’s midpoint to be a table value.'.replace('’', "'"),
    )
  })
  it('writes the Σ form, the widths and the terms as AP writes them', () => {
    const L = sumOf(tank, 0, 4, 'left')
    expect(L.sigmaTex).toBe('L_{4} = \\sum_{k=1}^{4} r(t_{k-1})\\,\\Delta t_k')
    expect(L.sigmaText).toBe('L₄ = Σ r(tₖ₋₁)·Δtₖ for k = 1 to 4')
    expect(L.widthsText).toBe('Δt₁ = 2, Δt₂ = 3, Δt₃ = 4, Δt₄ = 3')
    expect(L.text).toBe('L₄ = (2)(4.3) + (3)(5.0) + (4)(5.9) + (3)(7.1) = 68.5')
    expect(L.integralText).toBe('∫₀¹² r(t) dt ≈ 68.5 gallons')
    expect(L.chip).toBe('L₄ = 68.5')
    const T = sumOf(tank, 0, 4, 'trapezoid')
    expect(T.termsText[0]).toBe('½(2)(4.3 + 5.0)')
    expect(T.termsTex[0]).toBe('\\tfrac{1}{2}(2)(4.3 + 5.0)')
    // a sub-range keeps the table's own indices
    expect(sumOf(tank, 1, 3, 'right').sigmaTex).toBe('R_{2} = \\sum_{k=2}^{3} r(t_k)\\,\\Delta t_k')
    expect(sumOf(tank, 1, 3, 'right').widthsText).toBe('Δt₂ = 3, Δt₃ = 4')
  })
  it('a negative value is parenthesised in a product and subtracted in a trapezoid', () => {
    const p = pts([['0', '1'], ['2', '-3'], ['3', '2']])
    const L = sumOf(p, 0, 2, 'left')
    // (2)(1) + (1)(−3) = −1
    expect(L.text).toBe('L₂ = (2)(1) + (1)(−3) = −1')
    const T = sumOf(p, 0, 2, 'trapezoid')
    // ½(2)(1 − 3) + ½(1)(−3 + 2) = −2 − 0.5 = −2.5
    expect(T.termsText).toEqual(['½(2)(1 − 3)', '½(1)(−3 + 2)'])
    expect(T.result.rhs).toBe('= −2.5')
  })
})

describe('over- and underestimates: conditional, and only when the rows allow', () => {
  it('increasing rows: “if r is increasing, the left sum is an underestimate”', () => {
    expect(sumOf(tank, 0, 4, 'left').estimate).toBe(
      "If r is increasing on [0, 12], the left sum L₄ is an underestimate: each rectangle's height is r's smallest value on its subinterval.",
    )
    expect(sumOf(tank, 0, 4, 'right').estimate).toContain('the right sum R₄ is an overestimate')
  })
  it('rows that rise and fall: the table cannot say', () => {
    const p = pts([['0', '1'], ['1', '3'], ['2', '2']])
    expect(sumOf(p, 0, 2, 'left').estimate).toContain('the table alone cannot say')
  })
  it('a trapezoid turns on concavity: slopes 2, 1, −1, −3 allow “if concave down, an underestimate”', () => {
    const v = pts([['0', '12'], ['4', '20'], ['10', '26'], ['16', '20'], ['20', '8']])
    expect(sumOf(v, 0, 4, 'trapezoid').estimate).toBe(
      'If r is concave down on [0, 20], the trapezoidal sum T₄ is an underestimate: each trapezoid\'s top is a chord, which lies below the graph.',
    )
    // the tank's slopes 0.35, 0.3, 0.3, 0.433 fall and rise: no concavity claim
    expect(sumOf(tank, 0, 4, 'trapezoid').estimate).toContain('the table alone cannot say')
  })
  it('never claims monotonicity outright', () => {
    for (const m of ['left', 'right', 'trapezoid'] as const) {
      const e = sumOf(tank, 0, 4, m).estimate ?? ''
      expect(e === '' || /^If |cannot say/.test(e) || e.startsWith('The ')).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// derivative, average value
// ---------------------------------------------------------------------------

describe('the difference quotient', () => {
  const d = (c: string) => {
    const r = tableDerivative(tank, typedNum(c)!, c, TANK_NAMES)
    if (!r.ok) throw new Error(r.why)
    return r
  }
  it('between two rows: their quotient, with units', () => {
    // r′(7) ≈ (7.1 − 5.9)/(9 − 5) = 1.2/4 = 0.3
    expect(d('7').text).toBe('r′(7) ≈ (r(9) − r(5))/(9 − 5) = (7.1 − 5.9)/(9 − 5) = 1.2/4 = 0.3 gal/min per min')
    expect(d('7').how).toBe('between')
    expect(d('7').chip).toBe('r′(7) ≈ 0.3')
  })
  it('at an inner row: the rows either side (2.1/7 = 0.3)', () => {
    expect(d('5').how).toBe('central')
    expect([d('5').a.xText, d('5').b.xText]).toEqual(['2', '9'])
    expect(d('5').result.short).toBe('0.3')
  })
  it('at the ends: one-sided (0.7/2 = 0.35; 1.3/3 = 13/30 ≈ 0.433)', () => {
    expect(d('0').how).toBe('first')
    expect(d('0').result.rhs).toBe('= 0.35')
    expect(d('12').how).toBe('last')
    expect(d('12').result.rhs).toBe('= 13/30 ≈ 0.433')
  })
  it('a negative rate (the velocity table: (20 − 26)/(16 − 10) = −1)', () => {
    const v = pts([['0', '12'], ['4', '20'], ['10', '26'], ['16', '20'], ['20', '8']])
    const r = tableDerivative(v, typedNum('12')!, '12', tableNames('t (sec)', 'v(t) (ft/sec)'))
    expect(r.ok && r.text).toBe('v′(12) ≈ (v(16) − v(10))/(16 − 10) = (20 − 26)/(16 − 10) = (−6)/6 = −1 ft/sec per sec')
  })
  it('refuses a c outside the table', () => {
    const r = tableDerivative(tank, typedNum('13')!, '13', TANK_NAMES)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.why).toBe('t = 13 is outside the table, which runs from 0 to 12.')
  })
})

describe('the average value', () => {
  it('is the trapezoidal sum over b − a, the work shown (74.9/12 = 749/120 ≈ 6.242)', () => {
    const r = tableAverage(tank, 0, 4, TANK_NAMES)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.text).toBe('Average value of r on [0, 12] ≈ (1/(12 − 0))·T₄ = 74.9/12 = 749/120 ≈ 6.242 gal/min')
    expect(r.trap.result.short).toBe('74.9')
    expect(r.chip).toBe('avg ≈ 6.242')
    expect(r.workTex).toBe('\\frac{1}{12}\\,T_{4} = \\frac{74.9}{12} = \\frac{749}{120} \\approx 6.242\\ \\text{gal/min}')
  })
  it('on [2, 9]: T₂ = 42.35, so 42.35/7 = 6.05', () => {
    const r = tableAverage(tank, 1, 3, TANK_NAMES)
    expect(r.ok && r.result.rhs).toBe('= 6.05')
  })
})

// ---------------------------------------------------------------------------
// IVT / MVT
// ---------------------------------------------------------------------------

describe('the IVT and the MVT: stated only when the hypothesis is granted', () => {
  it('MVT granted: the AP sentence with the quotient and units', () => {
    const r = tableMvt(tank, 1, 3, true, TANK_NAMES)
    expect(r.ok && r.statement).toBe(
      'Because r is differentiable, r is continuous on [2, 9] and differentiable on (2, 9). By the Mean Value Theorem there is a value c in (2, 9) with r′(c) = (r(9) − r(2))/(9 − 2) = (7.1 − 5.0)/(9 − 2) = 2.1/7 = 0.3 gal/min per min.',
    )
    expect(r.ok && r.chip).toBe('r′(c) = 0.3')
  })
  it('MVT not granted: what is needed, and no conclusion', () => {
    const r = tableMvt(tank, 1, 3, false, TANK_NAMES)
    expect(r.ok && r.holds).toBe(false)
    expect(r.ok && r.statement).toContain('which a table cannot show')
    expect(r.ok && r.statement).not.toContain('there is a value c')
    expect(r.ok && r.chip).toBe('slope = 0.3')
  })
  it('Rolle: v(4) = v(16) gives v′(c) = 0', () => {
    const v = pts([['0', '12'], ['4', '20'], ['10', '26'], ['16', '20'], ['20', '8']])
    const r = tableMvt(v, 1, 3, true, tableNames('t (sec)', 'v(t) (ft/sec)'))
    expect(r.ok && r.result.rhs).toBe('= 0')
    expect(r.ok && r.statement).toContain("Rolle's theorem")
  })
  it('IVT granted and between: the AP sentence', () => {
    const r = tableIvt(tank, 1, 3, typedNum('6')!, '6', true, TANK_NAMES)
    expect(r.ok && r.statement).toBe(
      'Because r is differentiable, r is continuous on [2, 9]. Since r(2) = 5.0 < 6 < 7.1 = r(9), by the Intermediate Value Theorem there is a value c in (2, 9) with r(c) = 6 gal/min.',
    )
    expect(r.ok && r.chip).toBe('r(c) = 6')
  })
  it('IVT: not granted, not between, already attained', () => {
    const off = tableIvt(tank, 1, 3, typedNum('6')!, '6', false, TANK_NAMES)
    expect(off.ok && [off.holds, off.chip]).toEqual([false, null])
    expect(off.ok && off.statement).toContain('which a table cannot show')
    const out = tableIvt(tank, 1, 3, typedNum('8')!, '8', true, TANK_NAMES)
    expect(out.ok && out.statement).toContain('does not apply: 8 is not between r(2) = 5.0 and r(9) = 7.1')
    const hit = tableIvt(tank, 1, 3, typedNum('5')!, '5', true, TANK_NAMES)
    expect(hit.ok && hit.statement).toBe('No theorem is needed: r(2) = 5.0 already.')
    // a decreasing pair reads lowest first
    const dec = tableIvt(pts([['16', '20'], ['20', '8']]), 0, 1, typedNum('15')!, '15', true, tableNames('t (sec)', 'v(t) (ft/sec)'))
    expect(dec.ok && dec.statement).toContain('v(20) = 8 < 15 < 20 = v(16)')
  })
})

// ---------------------------------------------------------------------------
// the table as the card reads it
// ---------------------------------------------------------------------------

describe('an unsorted table, a repeated x, too few rows', () => {
  it('asks for x increasing, offers Sort by x, and sorting fixes it', () => {
    const d = table([['5', '5.9'], ['0', '4.3'], ['12', '8.4'], ['2', '5.0'], ['9', '7.1']], { calc: { sum: {} } })
    const r = readTable(d)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.canSort).toBe(true)
    expect(!r.ok && r.text).toBe('t must increase down the table: row 2 (t = 0) comes after t = 5.')
    const sorted = sortRowsByX(d.rows)
    expect(sorted.map((x) => x.x)).toEqual(['0', '2', '5', '9', '12'])
    expect(sorted.map((x) => x.y)).toEqual(['4.3', '5.0', '5.9', '7.1', '8.4'])
    const after = tableCalcCard({ ...d, rows: sorted })
    expect(after.sum?.result.ok && after.sum.result.result.short).toBe('68.5')
    // nothing is drawn while the table waits
    expect(tableCalcOverlays([d])).toEqual([])
    expect(tableCalcKeys(d)).toEqual([])
  })
  it('keeps blank or unreadable rows at the end when sorting', () => {
    expect(sortRowsByX([{ x: '3', y: '1' }, { x: '', y: '' }, { x: '1', y: '2' }, { x: 'abc', y: '4' }])).toEqual([
      { x: '1', y: '2' },
      { x: '3', y: '1' },
      { x: '', y: '' },
      { x: 'abc', y: '4' },
    ])
  })
  it('a repeated x cannot be sorted away', () => {
    const r = readTable(table([['0', '1'], ['2', '3'], ['2', '4']]))
    expect(!r.ok && r.canSort).toBe(false)
    expect(!r.ok && r.text).toContain('t = 2 appears twice (rows 2 and 3)')
  })
  it('needs two rows', () => {
    const r = readTable(table([['0', '1']]))
    expect(!r.ok && r.text).toBe('Calculus on a table needs at least two rows with both values.')
  })
})

describe('the settings: turning tools on and off, a lost row', () => {
  it('turnOn gives sensible starts; turnOff forgets', () => {
    const d = table(TANK)
    expect(turnOn(d, 'sum')).toEqual({ sum: {} })
    // c between the two middle rows: (2 + 5)/2 = 3.5
    expect(turnOn(d, 'deriv')).toEqual({ der: { c: '3.5' } })
    // y halfway between the end values: (4.3 + 8.4)/2 = 6.35
    expect(turnOn(d, 'ivt')).toEqual({ ivt: { y: '6.35' } })
    expect(turnOff({ sum: {} }, 'sum')).toBeUndefined()
    expect(turnOff({ sum: {}, avg: {} }, 'sum')).toEqual({ avg: {} })
  })
  it('an interval whose row has gone falls back to the whole table, and says so', () => {
    const card = tableCalcCard(table(TANK, { calc: { sum: { a: 3, b: 9 } } }))
    expect(card.sum?.lost).toContain('no longer in the table')
    expect([card.sum?.i, card.sum?.j]).toEqual([0, 4])
  })
})

// ---------------------------------------------------------------------------
// persistence
// ---------------------------------------------------------------------------

const META: DocMeta = { id: 'doc1', name: 'Tables', createdAt: 1000, modifiedAt: 1000 }
function board(data: BoardData[]): BoardInput {
  return {
    curves: [],
    styles: {},
    candidates: new Map<string, FitResult[]>(),
    exprSources: {},
    viewport: { center: { x: 6, y: 4 }, pxPerUnit: 40 },
    selectedId: null,
    mode: 'draw',
    data,
  }
}
const save = (b: BoardInput): string => serializeDoc(docFromBoard(META, b, 2000))

describe('persistence: only the settings, only when set', () => {
  const FULL = { sum: { m: 'trapezoid' as const, a: 2, b: 9 }, der: { c: '7' }, avg: { a: 2 }, mvt: { a: 2, b: 9 }, ivt: { b: 9, y: '6' }, diff: true as const }
  it('round-trips every setting', () => {
    const res = deserializeDoc(save(board([table(TANK, { calc: FULL })])))
    expect(res.problems).toEqual([])
    expect(res.board!.data[0].calc).toEqual(FULL)
  })
  it('an old document is byte-identical; defaults and an empty setting write nothing', () => {
    const before = save(board([table(TANK)]))
    expect(before).not.toContain('"calc"')
    expect(save(board([table(TANK, { calc: {} })]))).toBe(before)
    const back = deserializeDoc(before).board!
    expect(back.data[0].calc).toBeUndefined()
    expect(save(board(back.data))).toBe(before)
    // the left method is the default: not written
    const raw = JSON.parse(save(board([table(TANK, { calc: { sum: { m: 'left' } } })]))) as StoredDoc
    expect(raw.board.data![0].calc).toEqual({ sum: {} })
  })
  it('drops junk and keeps the rest', () => {
    expect(normalizeTableCalc({ sum: { m: 'sideways', a: 'x' }, der: { c: '' }, ivt: { y: 7 }, diff: 'yes', zzz: 1 })).toEqual({ sum: {}, ivt: {} })
    expect(normalizeTableCalc('nonsense')).toBeNull()
    expect(normalizeTableCalc({})).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// reveal, the student copy, the description, the exports
// ---------------------------------------------------------------------------

const ALL = table(TANK, { calc: { sum: {}, der: { c: '7' }, avg: {}, mvt: { a: 2, b: 9 }, ivt: { a: 2, b: 9, y: '6' }, diff: true } })

describe('reveal mode', () => {
  it('every computed value has its own key, in card order', () => {
    expect(tableCalcKeys(ALL)).toEqual(['sum', 'deriv', 'avg', 'mvt', 'ivt'].map((p) => tableCalcKey('T1', p as 'sum')))
    const inv = buildInventory({ curves: [], crossings: [], after: tableCalcKeys(ALL) })
    expect(inv.order[0]).toBe('tcalc:T1:sum')
  })
  it('the board keeps the setup (rectangles, secants, the target line) and hides every value', () => {
    const scene: BoardScene = {
      vp: { center: { x: 6, y: 4 }, pxPerUnit: 40, widthPx: 900, heightPx: 600 },
      theme: DARK_THEME,
      curves: [],
      styles: {},
      models: { ...MODELS },
      analysis: null,
      overlays: tableCalcOverlays([ALL]),
    }
    const labels = scene.overlays!.filter((o) => o.kind === 'label').map((o) => (o as { text: string }).text)
    expect(labels).toEqual(['L₄ = 68.5', 'r′(7) ≈ 0.3', 'avg ≈ 6.242', 'r′(c) = 0.3', 'r(c) = 6'])
    const inv = buildInventory({ curves: [], crossings: [], after: tableCalcKeys(ALL) })
    const r = (s: RevealState): SceneReveal => ({ hidden: (k) => isHidden(s, k), positions: true, pointKey: inv.answerKey, crossKey: inv.crossKey })
    const ON: RevealState = { ...REVEAL_OFF, on: true }
    const hidden = applyReveal(scene, r(ON))
    expect(hidden.overlays!.some((o) => o.kind === 'label')).toBe(false)
    // the rectangles and the two secants and the IVT line stay; the average line (its height is the answer) goes
    expect(hidden.overlays!.some((o) => o.kind === 'rects')).toBe(true)
    expect(hidden.overlays!.filter((o) => o.kind === 'segment')).toHaveLength(3)
    expect(hidden.revealMarks!.map((m) => m.key)).toEqual(tableCalcKeys(ALL))
    const one = applyReveal(scene, r(revealOne(ON, 'tcalc:T1:sum')))
    expect(one.overlays!.filter((o) => o.kind === 'label').map((o) => (o as { text: string }).text)).toEqual(['L₄ = 68.5'])
  })
  it('presentation’s panel says each answer in full', () => {
    const line = answerLine('tcalc:T1:sum', {
      object: (k) => {
        const [, , part] = k.split(':')
        const a = tableCalcAnswer(ALL, part)
        return { label: a.label, value: a.value, color: a.color, board: true }
      },
    })
    expect(line.label).toBe('Table 1 · Riemann / trapezoidal sum')
    expect(line.value).toBe('L₄ = (2)(4.3) + (3)(5.0) + (4)(5.9) + (3)(7.1) = 68.5; ∫₀¹² r(t) dt ≈ 68.5 gallons')
  })
})

describe('the figure, the student copy, the description and the exports', () => {
  const m = docModelFromJSON(save(board([ALL])))!

  it('the answer key draws the chips; the student copy keeps the setup and masks every value', () => {
    const key = docFigure(m, { style: 'textbook', answers: true })
    const keyLabels = key.scene.overlays!.filter((o) => o.kind === 'label').map((o) => (o as { text: string }).text)
    expect(keyLabels).toContain('L₄ = 68.5')
    const student = docFigure(m, { style: 'textbook', answers: false })
    expect(student.scene.overlays!.some((o) => o.kind === 'label')).toBe(false)
    expect(student.scene.overlays!.some((o) => o.kind === 'rects')).toBe(true)
    // the average line's height is the answer: off the student copy
    expect(student.scene.overlays!.filter((o) => o.kind === 'segment')).toHaveLength(3)
  })
  it('a sum frames the x-axis (the rectangles stand on it)', () => {
    const box = dataBox(ALL)!
    expect(box.min.y).toBe(0)
    expect(dataBox(table(TANK))!.min.y).toBeCloseTo(4.3, 9)
  })
  it('describeGraph says what is drawn always, and the values only as answers', () => {
    const key = describeBoard(m, { answers: true }).long
    expect(key).toContain('On Table 1, a left Riemann sum of r over [0, 12] is drawn as 4 rectangles with widths 2, 3, 4 and 3.')
    expect(key).toContain('L₄ = (2)(4.3) + (3)(5.0) + (4)(5.9) + (3)(7.1) = 68.5, so ∫₀¹² r(t) dt ≈ 68.5 gallons.')
    expect(key).toContain('By the Mean Value Theorem there is a value c in (2, 9)')
    expect(key).toContain('The difference quotient gives r′(7) ≈ (r(9) − r(5))/(9 − 5)')
    const student = describeBoard(m, { answers: false }).long
    expect(student).toContain('a left Riemann sum of r over [0, 12] is drawn')
    expect(student).not.toContain('68.5')
    expect(student).not.toContain('6.242')
    expect(student).not.toContain('Mean Value Theorem there is')
    const sentences = tableCalcSentences([ALL])
    expect(sentences.filter((s) => !s.answer).every((s) => !/68\.5|6\.242|0\.3\b/.test(s.text))).toBe(true)
  })
  it('TikZ and pgfplots draw the rectangles and the chips (key only)', () => {
    const key = docFigure(m, { style: 'ap', answers: true })
    const pgf = toPgfplots(key.scene, { sources: key.sources })
    expect(pgf).toContain('% Riemann rectangles')
    expect(pgf).toContain('68.5')
    const tikz = toTikz(recordFigure(key))
    expect(tikz).toContain('68.5')
    const student = docFigure(m, { style: 'ap', answers: false })
    expect(toPgfplots(student.scene, { sources: student.sources })).not.toContain('68.5')
  })
  it('a trapezoidal sum draws trapezoids, which export as filled paths', () => {
    const t = docModelFromJSON(save(board([table(TANK, { calc: { sum: { m: 'trapezoid' } } })])))!
    const f = docFigure(t, { style: 'ap', answers: true })
    expect(f.scene.overlays!.filter((o) => o.kind === 'path')).toHaveLength(4)
    expect(toPgfplots(f.scene, { sources: f.sources })).toContain('fill opacity')
  })
})

// ---------------------------------------------------------------------------
// the gallery examples: the numbers their notes state
// ---------------------------------------------------------------------------

describe('the gallery examples', () => {
  const load = (id: string) => {
    const def = exampleById(id)!
    const res = deserializeDoc(buildExample(def).json)
    expect(res.problems).toEqual([])
    return { def, d: res.board!.data[0] }
  }
  it('U6, the tank: L₄ = 68.5, R₄ = 81.3, T₄ = 74.9, M unavailable, average 749/120 ≈ 6.242 gal/min', () => {
    const { def, d } = load('calc-u6-table-riemann')
    const card = tableCalcCard(d)
    expect(card.sum?.result.ok && card.sum.result.text).toBe('L₄ = (2)(4.3) + (3)(5.0) + (4)(5.9) + (3)(7.1) = 68.5')
    expect(card.sum?.others.map((o) => o.chip)).toEqual(['R₄ = 81.3', null, 'T₄ = 74.9'])
    expect(card.avg?.result.ok && card.avg.result.result.rhs).toBe('= 749/120 ≈ 6.242')
    for (const s of ['L₄ = (2)(4.3) + (3)(5.0) + (4)(5.9) + (3)(7.1) = 68.5', 'R₄ = 81.3', 'T₄ = 74.9', '749/120 ≈ 6.242']) {
      expect(def.note).toContain(s)
    }
  })
  it('U8, the velocity table: T₄ = 396 feet, v′(12) ≈ −1, Rolle on [4, 16]', () => {
    const { def, d } = load('calc-u8-table-velocity')
    const card = tableCalcCard(d)
    // ½·4·32 + ½·6·46 + ½·6·46 + ½·4·28 = 64 + 138 + 138 + 56 = 396
    expect(card.sum?.result.ok && card.sum.result.integralText).toBe('∫₀²⁰ v(t) dt ≈ 396 feet')
    expect(card.deriv?.result.ok && card.deriv.result.result.short).toBe('−1')
    expect(card.mvt?.result.ok && card.mvt.result.holds && card.mvt.result.result.short).toBe('0')
    for (const s of ['T₄ = 396', '∫₀²⁰ v(t) dt ≈ 396 feet', 'v′(12) ≈ (20 − 26)/(16 − 10) = −1 ft/sec per sec', 'v(4) = v(16) = 20']) {
      expect(def.note).toContain(s)
    }
    expect(card.sum?.result.ok && card.sum.result.estimate).toContain('If v is concave down on [0, 20], the trapezoidal sum T₄ is an underestimate')
  })
})

// ---------------------------------------------------------------------------
// commands and help
// ---------------------------------------------------------------------------

describe('commands and help', () => {
  const IDS = ['table-riemann', 'table-derivative', 'table-average-value', 'table-mvt', 'table-ivt']
  it('registers the commands and lists them under AP Calculus units 1, 2, 5, 6 and 8', () => {
    for (const id of IDS) expect(COMMANDS.some((c) => c.id === id), id).toBe(true)
    const inSection = (sec: string): string[] =>
      HELP_SECTIONS.find((s) => s.id === sec)!.entries.flatMap((e) => ('id' in e ? [e.id] : []))
    expect(inSection('calc-2')).toContain('table-derivative')
    expect(inSection('calc-6')).toContain('table-riemann')
    expect(inSection('calc-8')).toContain('table-average-value')
    expect(inSection('calc-5')).toContain('table-mvt')
    expect(inSection('calc-1')).toContain('table-ivt')
  })
  it('each runs the App’s openTableCalc with its tool', () => {
    const calls: string[] = []
    const actions = new Proxy({} as CommandActions, {
      get: (_t, name: string) => (...args: unknown[]) => calls.push(`${name}(${args.map((a) => JSON.stringify(a)).join(', ')})`),
    })
    const ctx = { board: 'cartesian', readOnly: false, actions } as unknown as CommandContext
    for (const id of IDS) {
      const c = COMMAND_BY_ID.get(id)!
      expect(c.when(ctx)).toBe(true)
      c.run(ctx)
    }
    expect(calls).toEqual(['sum', 'deriv', 'avg', 'mvt', 'ivt'].map((t) => `openTableCalc("${t}")`))
  })
})

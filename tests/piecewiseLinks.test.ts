// ============================================================================
// tests/piecewiseLinks.test.ts — a piecewise function built as a TABLE of
// pieces (src/ui/piecewiseLinks.ts + src/ui/PiecewiseEditor.tsx).
//
// The core (src/core/piecewise.ts) owns the syntax, the reading back and the
// breakpoint verdicts, and is tested in tests/piecewise.test.ts. What is
// tested HERE is the UI half: the row operations (above all "+ piece" tiling
// the line from where the row above ended), rows ⇄ spec, the preview line
// being exactly the canonical source, the verdict list, per-cell validation,
// the Step tab, and the two components' markup.
// ============================================================================

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { parseExpression } from '../src/core/parse'
import { piecewiseSource, type PiecewiseSpec } from '../src/core/piecewise'
import {
  addRow,
  blankPiecewiseDraft,
  blankTable,
  commitTable,
  exampleDraft,
  moveRow,
  nameProblem,
  parkingTable,
  piecewiseOpenByDefault,
  piecewiseResult,
  piecewiseSectionSpec,
  removeRow,
  setCell,
  setOtherwise,
  stepFamilySource,
  stepTableSpec,
  tableFromSource,
  tableFromSpec,
  tableProblems,
  tableToSpec,
  toggleClosed,
  verdictSpec,
  verdictsFor,
  type PieceTable,
  type PiecewiseDraft,
} from '../src/ui/piecewiseLinks'
import { PiecewiseEditor, PiecewiseSection } from '../src/ui/PiecewiseEditor'

const HEADER_SRC = 'f(x) = {x^2 + 1 if x < 0, 3 if 0 <= x <= 2, -x + 5 if x > 2}'

const HEADER: PiecewiseSpec = {
  name: 'f',
  pieces: [
    { expr: 'x^2 + 1', hi: '0', loClosed: false, hiClosed: false },
    { expr: '3', lo: '0', hi: '2', loClosed: true, hiClosed: true },
    { expr: '-x + 5', lo: '2', loClosed: false, hiClosed: false },
  ],
}

const NOOP = (): void => undefined

function table(...rows: [string, string, string, boolean, boolean][]): PieceTable {
  return {
    rows: rows.map(([expr, lo, hi, loClosed, hiClosed]) => ({ expr, lo, hi, loClosed, hiClosed })),
    otherwise: false,
  }
}

// ---------------------------------------------------------------------------
// row ops
// ---------------------------------------------------------------------------

describe('row operations', () => {
  it('"+ piece" starts where the row above ends, with the other inclusivity', () => {
    // previous x ≤ 2 → next 2 < x
    let t = table(['x', '0', '2', true, true])
    t = addRow(t)
    expect(t.rows[1]).toEqual({ expr: '', lo: '2', hi: '', loClosed: false, hiClosed: false })
    // previous x < 5 → next 5 ≤ x
    t = setCell(t, 1, 'hi', '5')
    t = addRow(t)
    expect(t.rows[2]).toMatchObject({ lo: '5', loClosed: true })
  })

  it('"+ piece" after an unbounded row starts unbounded; into an empty table, a blank row', () => {
    const t = addRow(table(['x', '0', '', true, false]))
    expect(t.rows[1]).toEqual({ expr: '', lo: '', hi: '', loClosed: false, hiClosed: false })
    expect(addRow({ rows: [], otherwise: false }).rows).toHaveLength(1)
  })

  it('"+ piece" goes above an "otherwise" row, which stays last', () => {
    let t = table(['x', '', '0', false, true], ['0', '', '', false, false])
    t = setOtherwise(t, true)
    t = addRow(t)
    expect(t.rows).toHaveLength(3)
    expect(t.rows[1]).toMatchObject({ expr: '', lo: '0', loClosed: false })
    expect(t.rows[2].expr).toBe('0')
    expect(t.otherwise).toBe(true)
  })

  it('× removes a row; the last row left is cleared; removing "otherwise" clears the flag', () => {
    const t = table(['a', '', '0', false, false], ['b', '0', '', true, false])
    expect(removeRow(t, 0).rows.map((r) => r.expr)).toEqual(['b'])
    expect(removeRow(table(['x', '1', '2', true, true]), 0)).toEqual(blankTable())
    const ow = setOtherwise(t, true)
    expect(removeRow(ow, 1).otherwise).toBe(false)
    expect(removeRow(setOtherwise(table(['a', '', '', false, false], ['b', '', '', false, false], ['c', '', '', false, false]), true), 0).otherwise).toBe(true)
  })

  it('↑ / ↓ / drag move a row; moving into or out of the last place drops "otherwise"', () => {
    const t = table(['a', '', '', false, false], ['b', '', '', false, false], ['c', '', '', false, false])
    expect(moveRow(t, 0, 2).rows.map((r) => r.expr)).toEqual(['b', 'c', 'a'])
    expect(moveRow(t, 2, 0).rows.map((r) => r.expr)).toEqual(['c', 'a', 'b'])
    expect(moveRow(t, 1, 1)).toBe(t)
    expect(moveRow(t, 0, 5)).toBe(t)
    const ow = setOtherwise(t, true)
    expect(moveRow(ow, 0, 1).otherwise).toBe(true)
    expect(moveRow(ow, 2, 1).otherwise).toBe(false)
    expect(moveRow(ow, 0, 2).otherwise).toBe(false)
  })

  it('clicking a relation toggles < ⇄ ≤; an unbounded side has nothing to toggle', () => {
    const t = table(['x', '0', '', false, false])
    expect(toggleClosed(t, 0, 'lo').rows[0].loClosed).toBe(true)
    expect(toggleClosed(toggleClosed(t, 0, 'lo'), 0, 'lo').rows[0].loClosed).toBe(false)
    expect(toggleClosed(t, 0, 'hi')).toBe(t)
  })
})

// ---------------------------------------------------------------------------
// spec ⇄ rows, preview, verdicts
// ---------------------------------------------------------------------------

describe('the header example', () => {
  it('rows → spec → rows round trip', () => {
    const t = tableFromSpec(HEADER)
    expect(t.rows).toEqual([
      { expr: 'x^2 + 1', lo: '', hi: '0', loClosed: false, hiClosed: false },
      { expr: '3', lo: '0', hi: '2', loClosed: true, hiClosed: true },
      { expr: '-x + 5', lo: '2', hi: '', loClosed: false, hiClosed: false },
    ])
    expect(t.otherwise).toBe(false)
    expect(tableToSpec(t, 'f')).toEqual(HEADER)
    expect(tableToSpec(exampleDraft().pieces, 'f')).toEqual(HEADER)
  })

  it('the typed line reads back into the same table', () => {
    const back = tableFromSource(HEADER_SRC)
    expect(back?.name).toBe('f')
    expect(back?.table).toEqual(tableFromSpec(HEADER))
    expect(tableFromSource('y = x^2 + 1')).toBeNull()
    expect(tableFromSource('')).toBeNull()
  })

  it('the preview is exactly the canonical source, and it parses as a cases block', () => {
    const r = piecewiseResult(exampleDraft())
    expect(r.src).toBe(HEADER_SRC)
    expect(r.previewSrc).toBe(HEADER_SRC)
    expect(r.src).toBe(piecewiseSource(HEADER))
    expect(r.latex).toMatch(/\\begin\{cases\}/)
    expect(r.problems).toEqual([])
    expect(r.error).toBeNull()
  })

  it('verdicts: a jump of 2 at 0, continuous at 2', () => {
    const r = piecewiseResult(exampleDraft())
    expect(r.verdicts.map((v) => v.kind)).toEqual(['jump', 'continuous'])
    expect(r.verdicts[0].text).toMatch(/^jump of 2 at x = 0/)
    expect(r.verdicts[1].text).toBe('continuous at x = 2')
  })

  it('no name writes y = …', () => {
    const r = piecewiseResult({ ...exampleDraft(), name: '' })
    expect(r.src).toBe('y = {x^2 + 1 if x < 0, 3 if 0 <= x <= 2, -x + 5 if x > 2}')
    expect(nameProblem('ff')).toMatch(/one letter/)
    expect(nameProblem('x')).toMatch(/taken/)
    expect(piecewiseResult({ ...exampleDraft(), name: 'x' }).src).toBeNull()
  })
})

describe('gaps, overlaps and "otherwise"', () => {
  const draftOf = (t: PieceTable): PiecewiseDraft => ({ ...blankPiecewiseDraft(), pieces: t })

  it('a gap is named', () => {
    const r = piecewiseResult(draftOf(table(['x', '', '2', false, true], ['5', '3', '', true, false])))
    expect(r.src).not.toBeNull()
    expect(r.verdicts[0]).toMatchObject({ kind: 'gap', text: 'gap: f is not defined on 2 < x < 3' })
  })

  it('an overlap is named — both pieces include the point and disagree', () => {
    const r = piecewiseResult(draftOf(table(['x', '', '1', false, true], ['5', '1', '', true, false])))
    expect(r.verdicts[0].kind).toBe('overlap')
    expect(r.verdicts[0].text).toMatch(/^overlap at x = 1: two pieces both include x = 1/)
  })

  it('"otherwise" owns only what no other row covers: no false overlap', () => {
    const t = setOtherwise(table(['x', '0', '2', true, false], ['0', '', '', false, false]), true)
    const spec = tableToSpec(t, 'f')
    expect(spec.pieces[1]).toEqual({ expr: '0', loClosed: false, hiClosed: false })
    const r = piecewiseResult(draftOf(t))
    expect(r.src).toBe('f(x) = {x if 0 <= x < 2, 0 otherwise}')
    expect(verdictSpec(spec).pieces).toHaveLength(3)
    expect(r.verdicts.map((v) => v.kind)).toEqual(['continuous', 'jump'])
    // the otherwise row's bound fields are ignored even when filled
    const filled = setCell(t, 1, 'lo', 'nonsense(')
    expect(tableProblems(filled)).toEqual([])
  })
})

describe('validation, one cell at a time', () => {
  it('names the offending cell', () => {
    const t = table(['x^2 +', '', '0', false, false], ['3', '0', 'x', true, true], ['y + 1', '5', '4', false, false])
    const ps = tableProblems(t)
    expect(ps.map((p) => [p.row, p.cell])).toEqual([
      [0, 'expr'],
      [1, 'hi'],
      [2, 'expr'],
      [2, 'hi'],
    ])
    expect(ps[1].message).toMatch(/formula in x/)
    expect(ps[3].message).toMatch(/wrong way round/)
    const r = piecewiseResult({ ...blankPiecewiseDraft(), pieces: t })
    expect(r.src).toBeNull()
    expect(r.verdicts).toEqual([])
  })

  it('accepts what the parser does: sqrt(x), pi, 1/2, ∞ spelled out; a single point x = c', () => {
    const t = table(['sqrt(x)', '0', 'pi', true, false], ['1/2', 'pi', 'inf', true, false], ['7', '-1', '-1', true, true])
    expect(tableProblems(t)).toEqual([])
    expect(tableProblems(table(['7', '-1', '-1', true, false]))[0].message).toMatch(/empty/)
  })
})

// ---------------------------------------------------------------------------
// the Step tab
// ---------------------------------------------------------------------------

describe('the Step tab', () => {
  it('the greatest-integer family writes a floor line', () => {
    const d = blankPiecewiseDraft()
    expect(stepFamilySource(d.step)).toBe('y = floor(x)')
    expect(stepFamilySource(d.step, 'g')).toBe('g(x) = floor(x)')
    const r = piecewiseResult({ ...d, tab: 'step', step: { ...d.step, a: '2', b: '1/2', h: '-1', k: '3' } })
    expect(r.src).toMatch(/^f\(x\) = .*floor\(/)
    expect(r.latex).toMatch(/\\lfloor/)
    expect(r.sentence).toMatch(/^steps 2 wide, each 2 up/)
    const ceil = piecewiseResult({ ...d, tab: 'step', step: { ...d.step, kind: 'ceil' } })
    expect(ceil.src).toBe('f(x) = ceil(x)')
    expect(ceil.sentence).toMatch(/open on the left/)
    const bad = piecewiseResult({ ...d, tab: 'step', step: { ...d.step, b: '0' } })
    expect(bad.src).toBeNull()
    expect(bad.error).toMatch(/b = 0/)
  })

  it('a parking-fee table becomes a spec through stepSpec, and a line', () => {
    const spec = stepTableSpec(parkingTable())
    expect(spec.pieces).toEqual([
      { expr: '5', lo: '0', hi: '1', loClosed: false, hiClosed: true },
      { expr: '8', lo: '1', hi: '2', loClosed: false, hiClosed: true },
      { expr: '11', lo: '2', hi: '3', loClosed: false, hiClosed: true },
    ])
    const d = blankPiecewiseDraft()
    const r = piecewiseResult({ ...d, tab: 'step', step: { ...d.step, mode: 'table', table: parkingTable() } })
    expect(r.src).toBe('f(x) = {5 if 0 < x <= 1, 8 if 1 < x <= 2, 11 if 2 < x <= 3}')
    expect(r.verdicts.map((v) => v.kind)).toEqual(['end', 'jump', 'jump', 'end'])
    expect(r.verdicts[1].text).toMatch(/^jump of 3 at x = 1/)
  })
})

// ---------------------------------------------------------------------------
// the card section's commit
// ---------------------------------------------------------------------------

describe('the card section', () => {
  it('a committed edit restates the canonical line; a bad table restates nothing', () => {
    const t = tableFromSpec(HEADER)
    expect(commitTable(t, 'f')).toEqual({ src: HEADER_SRC, error: null })
    const edited = toggleClosed(t, 0, 'hi')
    expect(commitTable(edited, 'f').src).toBe('f(x) = {x^2 + 1 if x <= 0, 3 if 0 <= x <= 2, -x + 5 if x > 2}')
    const bad = setCell(t, 1, 'expr', '3 +')
    expect(commitTable(bad, 'f').src).toBeNull()
  })

  it('which lines get a section, and which open by themselves', () => {
    expect(piecewiseSectionSpec(HEADER_SRC)).toEqual(HEADER)
    expect(piecewiseSectionSpec('y = x^2')).toBeNull()
    expect(piecewiseOpenByDefault(HEADER_SRC)).toBe(true)
    expect(piecewiseSectionSpec('y = x^2 {0 <= x < 3}')).not.toBeNull()
    expect(piecewiseOpenByDefault('y = x^2 {0 <= x < 3}')).toBe(false)
  })

  it('verdicts use the slider values', () => {
    const src = 'y = {a x if x < 1, 2 if x >= 1}'
    expect(parseExpression(src).ok).toBe(true)
    const spec = piecewiseSectionSpec(src)!
    expect(verdictsFor(spec, { a: 2 })[0].kind).toBe('continuous')
    expect(verdictsFor(spec, { a: 1 })[0].kind).toBe('jump')
  })
})

// ---------------------------------------------------------------------------
// calls of the board's named curves
// ---------------------------------------------------------------------------

describe('a piece may call a named curve', () => {
  // g(x) = x^2 on the board, as src/ui/nameLinks.ts's lineEnv hands it over
  const env = { has: (n: string) => n === 'g' || n === 'f', eval: (n: string, x: number) => (n === 'g' ? x * x : NaN) }
  const envFor = () => env
  const t = table(['g(x) + 1', '', '0', false, false], ["g'(x)", '0', '', true, false])

  it('the cells validate against the env, not as sliders', () => {
    // g'(x) is a derivative call: only an env that has g reads it
    expect(tableProblems(t).map((p) => p.row)).toEqual([1])
    expect(tableProblems(t, env)).toEqual([])
  })

  it('the preview and the verdicts use g’s values', () => {
    const r = piecewiseResult({ ...blankPiecewiseDraft(), pieces: t }, envFor)
    expect(r.src).toBe("f(x) = {g(x) + 1 if x < 0, g'(x) if x >= 0}")
    expect(r.error).toBeNull()
    // left: g(0) + 1 = 1; right: g'(0) = 0
    expect(r.verdicts[0].text).toMatch(/^jump of 1 at x = 0: left limit 1, right limit 0/)
  })

  it('the card commit parses with the env too', () => {
    expect(commitTable(t, 'f').src).toBeNull()
    expect(commitTable(t, 'f', envFor).src).toBe("f(x) = {g(x) + 1 if x < 0, g'(x) if x >= 0}")
  })
})

// ---------------------------------------------------------------------------
// markup
// ---------------------------------------------------------------------------

describe('PiecewiseEditor markup', () => {
  it('the Pieces tab: one row per piece, bounds with ○/● and the verdicts', () => {
    const html = renderToStaticMarkup(
      createElement(PiecewiseEditor, { initial: exampleDraft(), onAdd: () => null, onClose: NOOP }),
    )
    expect(html).toContain('data-testid="piecewise-editor"')
    expect(html).toContain('>Pieces<')
    expect(html).toContain('>Step<')
    expect(html).toContain('data-testid="pw-row-2"')
    expect(html).toContain('value="x^2 + 1"')
    expect(html).toContain('placeholder="−∞"')
    expect(html).toContain('placeholder="∞"')
    expect(html).toContain('●')
    expect(html).toContain('○')
    expect(html).toContain('+ piece')
    expect(html).toContain('otherwise')
    expect(html).toContain(`data-src="${HEADER_SRC.replace(/</g, '&lt;').replace(/>/g, '&gt;')}"`)
    expect(html).toContain('jump of 2 at x = 0')
    expect(html).toContain('continuous at x = 2')
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>Add to graph/)
  })

  it('the Name field starts at the board’s next free letter, and says when a letter is taken', () => {
    const html = renderToStaticMarkup(
      createElement(PiecewiseEditor, { defaultName: 'g', takenNames: ['f'], onAdd: () => null, onClose: NOOP }),
    )
    expect(html).toMatch(/data-testid="pw-name"[^>]*value="g"|value="g"[^>]*data-testid="pw-name"/)
    expect(html).not.toContain('pw-name-taken')
    const taken = renderToStaticMarkup(
      createElement(PiecewiseEditor, { initial: exampleDraft(), takenNames: ['f'], onAdd: () => null, onClose: NOOP }),
    )
    expect(taken).toContain('data-testid="pw-name-taken"')
  })

  it('a bad cell is red and Add is disabled', () => {
    const d: PiecewiseDraft = { ...blankPiecewiseDraft(), pieces: table(['x^2 +', '', '0', false, false]) }
    const html = renderToStaticMarkup(createElement(PiecewiseEditor, { initial: d, onAdd: () => null, onClose: NOOP }))
    expect(html).toContain('fe-input-bad')
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Add to graph/)
  })

  it('the Step tab: the family, then a table', () => {
    const d = blankPiecewiseDraft()
    const fam = renderToStaticMarkup(
      createElement(PiecewiseEditor, { initial: { ...d, tab: 'step' }, onAdd: () => null, onClose: NOOP }),
    )
    expect(fam).toContain('data-testid="pw-tab-step"')
    expect(fam).toContain('Greatest integer')
    expect(fam).toContain('data-src="f(x) = floor(x)"')
    const tab = renderToStaticMarkup(
      createElement(PiecewiseEditor, {
        initial: { ...d, tab: 'step', step: { ...d.step, mode: 'table', table: parkingTable() } },
        onAdd: () => null,
        onClose: NOOP,
      }),
    )
    expect(tab).toContain('data-testid="pw-step-row-2"')
    expect(tab).toContain('value="11"')
    expect(tab).toContain('jump of 3 at x = 1')
  })
})

describe('PiecewiseSection markup', () => {
  it('the typed line as an editable table with its verdicts', () => {
    const html = renderToStaticMarkup(createElement(PiecewiseSection, { src: HEADER_SRC, onRestate: () => null }))
    expect(html).toContain('data-testid="piecewise-section"')
    expect(html).toContain('data-testid="pws-row-2"')
    expect(html).toContain('value="-x + 5"')
    expect(html).toContain('jump of 2 at x = 0')
  })

  it('nothing for a line that is not piecewise', () => {
    expect(renderToStaticMarkup(createElement(PiecewiseSection, { src: 'y = x^2', onRestate: () => null }))).toBe('')
  })
})

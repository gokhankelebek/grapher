// ============================================================================
// tests/presentReveal.test.ts — reveal mode on a projector.
//
// In presentation the sidebar is hidden, so a value only a card states (a
// Riemann sum, a domain, a classification) used to be revealed into nothing:
// the counter moved, the wall did not. Now every revealed key becomes a line
// of the board's "Revealed answers" panel (src/ui/revealedAnswers.ts), the
// counter reads "k of N revealed" everywhere, and the legend keeps off the x
// axis's numbers.
// ============================================================================

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FittedCurve, ModelSpec, SpecialPoint } from '../src/core/types'
import { parseExpression } from '../src/core/parse'
import { analyzeCurve } from '../src/core/analyze'
import type { CalcLink } from '../src/core/persist'
import { cardCalc } from '../src/ui/calcLinks'
import {
  REVEAL_OFF,
  buildInventory,
  calcKey,
  domainKey,
  familyKey,
  hideAll,
  rangeKey,
  revealAll,
  revealCount,
  revealNext,
  revealOne,
} from '../src/ui/reveal'
import type { RevealState } from '../src/ui/reveal'
import { UNREADABLE, answerLine, panelWindow, revealedKeys, revealedLines } from '../src/ui/revealedAnswers'
import type { AnswerSources } from '../src/ui/revealedAnswers'
import { calcLinesOf, circlePartText, shapePartText, tablePartText } from '../src/app/usePresentAnswers'
import { familyFactLines, familyKeyOf } from '../src/ui/familyFacts'
import { PresentAnswers } from '../src/ui/PresentAnswers'
import { RevealControls, revealCountText } from '../src/ui/RevealControls'
import type { RevealControlsProps } from '../src/ui/RevealControls'
import { legendNudge, xLabelBand } from '../src/ui/present'

// ---------------------------------------------------------------------------
// fixtures: the review's board — f(x) = x²/2 + 1 with a left and a right sum
// ---------------------------------------------------------------------------

function typed(id: string, src: string, n: number): { c: FittedCurve; models: Record<string, ModelSpec> } {
  const o = parseExpression(src)
  if (!o.ok) throw new Error(`fixture failed to parse: ${src}`)
  const modelId = `expr_${n}`
  return {
    c: {
      id,
      modelId,
      params: o.plot.defaultParams.slice(),
      kind: o.plot.kind,
      domain: o.plot.domain,
      color: '#4f9cf9',
      strokeWidth: 2.5,
      visible: true,
      error: 0,
    } as FittedCurve,
    models: { [modelId]: o.plot.makeModel(modelId) },
  }
}

const SRC = 'y = x^2/2 + 1'
const f = typed('f', SRC, 1)
const g = typed('g', 'y = x + 2', 2)
const models: Record<string, ModelSpec> = { ...f.models, ...g.models }
const LINKS: CalcLink[] = [
  { kind: 'riemann', id: 'R1', parentId: 'f', from: 0, to: 4, n: 4, method: 'left' },
  { kind: 'riemann', id: 'R2', parentId: 'f', from: -4, to: 0, n: 50, method: 'right' },
  { kind: 'area', id: 'A1', parentId: 'f', from: 0, to: 4, abs: false },
] as CalcLink[]
const cards = cardCalc(LINKS, [f.c, g.c], models, (c) => c.id, { f: 'f', g: 'g' }, {}, { f: SRC, g: 'y = x + 2' })
const fPoints = analyzeCurve(f.c, models)
const gPoints = analyzeCurve(g.c, models)

const inv = buildInventory({
  curves: [
    {
      id: 'f',
      points: fPoints,
      asymptotes: 0,
      domain: true,
      inverse: true,
      calc: ['R1', 'R2', 'A1'],
      extra: [familyKeyOf(f.c, SRC, models) ?? 'missing'],
    },
    { id: 'g', points: gPoints },
  ],
  crossings: [],
})

const sources: AnswerSources = {
  curve: (id) => (id === 'f' || id === 'g' ? { name: id, color: '#4f9cf9' } : null),
  point: (key) => inv.pointOf(key),
  domain: (id) =>
    id === 'f' ? { domain: 'all real numbers', range: 'y ≥ 1', oneToOne: 'No — y = 3 at x = −2 and 2', inverse: 'f isn’t one-to-one — restrict its domain first' } : null,
  family: (id) => (id === 'f' ? familyFactLines('explicit', SRC) : []),
  calc: (linkId) => calcLinesOf(cards).get(linkId) ?? null,
}

// ---------------------------------------------------------------------------

describe('every revealed answer is said somewhere the room can see', () => {
  it('the board has the answers the review stepped through', () => {
    expect(inv.order).toContain(calcKey('R1'))
    expect(inv.order).toContain(calcKey('R2'))
    expect(inv.order).toContain(domainKey('f'))
    expect(inv.order).toContain(rangeKey('f'))
    expect(inv.order).toContain(familyKey('f'))
    expect(inv.order.some((k) => k.startsWith('curve:f:min'))).toBe(true)
  })

  it('each key in the teaching order maps to a line with a real value', () => {
    for (const key of inv.order) {
      const l = answerLine(key, sources)
      expect(l.key).toBe(key)
      expect(l.label.length, key).toBeGreaterThan(0)
      expect(l.value, key).not.toBe(UNREADABLE)
      expect(l.value.trim().length, key).toBeGreaterThan(0)
    }
  })

  it('a card-only value (a Riemann sum, a domain) says its number, and is a panel line', () => {
    const r = answerLine(calcKey('R1'), sources)
    expect(r.label).toBe('f · Riemann sum')
    expect(r.value).toMatch(/L₄/)
    expect(r.place).toBe('panel')
    expect(answerLine(calcKey('A1'), sources).value).toMatch(/∫/)
    const d = answerLine(domainKey('f'), sources)
    expect(d).toMatchObject({ label: 'f · domain', value: 'all real numbers', place: 'panel' })
    expect(answerLine(rangeKey('f'), sources).value).toBe('y ≥ 1')
  })

  it('a point answer says where it is, and is drawn on the board too', () => {
    const minKey = inv.order.find((k) => k.startsWith('curve:f:min'))!
    const l = answerLine(minKey, sources)
    expect(l.label).toBe('f · minimum')
    expect(l.value).toBe('(0, 1)')
    expect(l.place).toBe('board')
  })

  it('the transformation facts: the images, the vertex, the range', () => {
    const l = answerLine(familyKey('f'), sources)
    expect(l.value).toContain('images: (−2, 3)')
    expect(l.value).toContain('vertex: (0, 1)')
    // domain and range are said under their own keys, not twice
    expect(l.value).not.toContain('range:')
  })

  it('a key whose value cannot be read still makes a line — a Next never passes silently', () => {
    const l = answerLine('calc:gone:value', {})
    expect(l.value).toBe(UNREADABLE)
    expect(answerLine('uc:u1:values', {}).place).toBe('board')
    expect(answerLine('series:q1:value', { object: () => ({ label: 'Series', value: 'S₁₀ ≈ 1.998' }) }).value).toBe('S₁₀ ≈ 1.998')
  })

  it('a board chip stands in when a reader has no value: an MVT c, a circle label', () => {
    const l = answerLine('calc:S1:value', { chips: (k) => (k === 'calc:S1:value' ? ['c = 2√3/3'] : []) })
    expect(l.value).toBe('c = 2√3/3')
  })

  it('a reader that throws is a line, not a crash', () => {
    const l = answerLine(domainKey('f'), {
      domain: () => {
        throw new Error('boom')
      },
    })
    expect(l.value).toBe(UNREADABLE)
  })

  it('every kind of key in src/ui/reveal.ts has a label', () => {
    const keys = [
      'curve:f:zero:0', 'curve:f:yint:0', 'curve:f:max:0', 'curve:f:infl:0', 'curve:f:asym:0', 'curve:f:domain',
      'curve:f:range', 'curve:f:onetoone', 'curve:f:inverse', 'curve:f:complex', 'curve:f:family', 'cross:f:g:0',
      'cross:f:g:same', 'calc:L1:value', 'solve:n1:solution', 'uc:u1:values', 'rr:r1:value', 'stat:s1:value',
      'series:q1:value', 'euler:F1:value', 'system:value', 'table:f:values', 'table:f:eval', 'table:f:compare',
      'table:f:divide', 'shape:p1:lengths', 'shape:p1:centroid', 'circle:c:angles', 'circle:c:square',
    ]
    for (const k of keys) {
      const l = answerLine(k, {})
      expect(l.label.length, k).toBeGreaterThan(0)
      expect(l.value.length, k).toBeGreaterThan(0)
    }
  })
})

describe('the panel lists answers in the order they were revealed', () => {
  it('reveal order, not teaching order, and only what is still on the board', () => {
    let s: RevealState = { ...REVEAL_OFF, on: true }
    s = revealOne(s, calcKey('R2'))
    s = revealOne(s, domainKey('f'))
    s = revealOne(s, 'calc:deleted:value')
    expect(revealedKeys(s, inv.order)).toEqual([calcKey('R2'), domainKey('f')])
    const lines = revealedLines(s, inv.order, sources)
    expect(lines.map((l) => l.key)).toEqual([calcKey('R2'), domainKey('f')])
  })

  it('stepping with Next adds one line each time; Reset empties it; All lists them all', () => {
    let s: RevealState = { ...REVEAL_OFF, on: true }
    for (let i = 1; i <= 3; i++) {
      s = revealNext(s, inv.order).state
      expect(revealedLines(s, inv.order, sources)).toHaveLength(i)
    }
    expect(revealedLines(hideAll(s), inv.order, sources)).toEqual([])
    expect(revealedLines(revealAll(s, inv.order), inv.order, sources)).toHaveLength(inv.order.length)
  })

  it('the newest few show; the earlier ones fold into a count', () => {
    expect(panelWindow([1, 2, 3, 4])).toEqual({ shown: [1, 2, 3, 4], earlier: 0 })
    expect(panelWindow([1, 2, 3, 4, 5, 6, 7])).toEqual({ shown: [4, 5, 6, 7], earlier: 3 })
  })

  it('renders at presentation scale, newest highlighted, nothing before the first reveal', () => {
    let s: RevealState = { ...REVEAL_OFF, on: true }
    expect(renderToStaticMarkup(createElement(PresentAnswers, { lines: [], total: 9, type: 2.5, side: 'right' }))).toBe('')
    s = revealOne(s, calcKey('R1'))
    s = revealOne(s, calcKey('R2'))
    const lines = revealedLines(s, inv.order, sources)
    const html = renderToStaticMarkup(createElement(PresentAnswers, { lines, total: inv.order.length, type: 2.5, side: 'right' }))
    expect(html).toContain('data-testid="present-answers"')
    expect(html).toContain('present-answers-right')
    expect(html).toContain('font-size:28px')
    expect(html).toContain(`2 of ${inv.order.length}`)
    expect((html.match(/present-answer-new/g) ?? []).length).toBe(1)
    expect(html).toMatch(new RegExp(`present-answer present-answer-new" data-answer-key="${calcKey('R2')}"`))
    expect(html).toContain('R₅₀')
  })
})

describe('the readers the panel uses', () => {
  it('calculus rows by link id, from the cards themselves', () => {
    const m = calcLinesOf(cards)
    expect(m.get('R1')).toMatchObject({ label: 'Riemann sum', curveId: 'f' })
    expect(m.get('A1')?.label).toBe('definite integral')
  })

  it('a table part, a circle part and a shape part as one line', () => {
    expect(tablePartText(null, 'values')).toBeNull()
    expect(circlePartText(null, 'square', 'x^2 + y^2 - 4x + 6y - 3 = 0')).toMatch(/\(x\s*-\s*2\)/)
    expect(shapePartText(undefined, 'lengths')).toBeNull()
    expect(
      shapePartText(
        { kind: 'polygon', id: 'p', pts: [], color: '#fff', visible: true, measure: { lengths: ['3', null, '5'] } } as never,
        'lengths',
      ),
    ).toBe('3, 5')
  })

  it('family facts for a conic: centre, foci', () => {
    expect(familyFactLines('implicit', '(x-2)^2/9 + (y+1)^2/4 = 1').join(' · ')).toMatch(/center: \(2, −1\)/)
    expect(familyKeyOf({ id: 'c', kind: 'implicit', modelId: 'expr_9' }, 'x^2 + y^2 = 25', {})).toBe('curve:c:family')
    expect(familyKeyOf({ id: 'p', kind: 'explicit', modelId: 'poly2' }, SRC, {})).toBeNull()
    expect(familyKeyOf(f.c, SRC, models, 'calls-h')).toBeNull()
  })
})

// ---------------------------------------------------------------------------

const CONTROLS: RevealControlsProps = {
  on: true,
  hidden: 6,
  total: 9,
  positions: true,
  onToggle: () => {},
  onNext: () => {},
  onAll: () => {},
  onReset: () => {},
  onPositions: () => {},
}

describe('the counter reads "k of N revealed", everywhere', () => {
  it('counts what has been revealed, so it runs forwards', () => {
    expect(revealCountText(9, 9)).toBe('0 of 9 revealed')
    expect(revealCountText(8, 9)).toBe('1 of 9 revealed')
    expect(revealCountText(0, 9)).toBe('9 of 9 revealed')
    expect(revealCountText(0, 0)).toBe('0 of 0 revealed')
    // a count that briefly disagrees never reads below 0 or above N
    expect(revealCountText(12, 9)).toBe('0 of 9 revealed')
  })

  it('on the board, in the presentation bar and in a student view', () => {
    const counts = [revealCount({ ...REVEAL_OFF, on: true }, ['a', 'b', 'c']), revealCount({ ...REVEAL_OFF, on: true, revealed: ['a'] }, ['a', 'b', 'c'])]
    expect(counts).toEqual([
      { hidden: 3, total: 3 },
      { hidden: 2, total: 3 },
    ])
    for (const extra of [{}, { present: true }, { student: true }]) {
      const html = renderToStaticMarkup(createElement(RevealControls, { ...CONTROLS, ...extra }))
      expect(html).toContain('3 of 9 revealed')
      expect(html).not.toMatch(/\d+\/\d+/)
    }
  })
})

// ---------------------------------------------------------------------------

describe('the presentation legend keeps off the x axis numbers', () => {
  // The review's board: a 449px-high stage, the axis at y = 365, type 2.5.
  const H = 449
  const band = xLabelBand(365, H, 2.5, 11)

  it('the numbers sit just under the axis, at the presented size', () => {
    expect(band.top).toBeCloseTo(365 + 12.5 - 2, 5)
    expect(band.bottom - band.top).toBeGreaterThan(27)
  })

  it('a bottom-left legend over the numbers steps up above them', () => {
    const box = { top: 380, bottom: 437 }
    const dy = legendNudge('bottom-left', box, band, H)
    expect(dy).toBeLessThan(0)
    expect(box.bottom + dy).toBeLessThanOrEqual(band.top)
  })

  it('no room above: it goes below the numbers instead', () => {
    const lowBand = xLabelBand(20, H, 2.5, 11)
    const box = { top: 10, bottom: 60 }
    const dy = legendNudge('top-left', box, lowBand, H)
    expect(box.top + dy).toBeGreaterThanOrEqual(lowBand.bottom)
    // a bottom legend as tall as the space above the numbers drops below them
    const tall = { top: 300, bottom: 400 }
    const up = legendNudge('bottom-right', tall, xLabelBand(80, H, 2.5, 11), H)
    expect(tall.top + up).toBeGreaterThanOrEqual(xLabelBand(80, H, 2.5, 11).bottom)
  })

  it('a legend clear of the numbers is left where it is', () => {
    expect(legendNudge('bottom-left', { top: 200, bottom: 260 }, band, H)).toBe(0)
    expect(legendNudge('top-right', { top: 12, bottom: 60 }, band, H)).toBe(0)
  })

  it('an axis below the board slides its numbers along the bottom edge', () => {
    const b = xLabelBand(2000, H, 2.5, 11)
    expect(b.bottom).toBeLessThanOrEqual(H)
  })
})

// keep the type import honest for readers of this file
export type { SpecialPoint }

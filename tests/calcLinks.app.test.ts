// ============================================================================
// tests/calcLinks.app.test.ts — the App's half of "area between two curves".
//
// The mathematics (areaBetween, curveIntersections) is tested beside core, and
// the shading beside the renderer. What is tested HERE is the wiring a teacher
// actually touches:
//
//   - the menu item is only offered when there IS a second curve to point at;
//   - with exactly one other curve nothing is armed, because there is no
//     question to ask — the teacher meant that one;
//   - with two or more, the next tap answers it, and a tap on nothing (or
//     Escape) cancels in words rather than leaving the board armed;
//   - a fresh region reads |f − g|, not the signed integral that cancels;
//   - the region dies with EITHER curve, and the toast calls it a shaded area;
//   - the parent's card says WHICH two curves, and the other curve's card says
//     why it is shaded and whose card owns it.
//
// The card assertions render the real CurveCard to static markup: a row that
// only "would" say Between is a row nothing checks.
// ============================================================================

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FittedCurve, ModelSpec } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import type { AreaLink, CalcLink } from '../src/core/persist'
import { cardCalc, defaultBetweenBounds, dependentsOf, linkNoun } from '../src/ui/calcLinks'
import {
  BETWEEN_ABS,
  BETWEEN_CANCELLED,
  betweenCardInfo,
  betweenIntent,
  betweenNotice,
  betweenTargets,
} from '../src/App'
import { CurveCard } from '../src/ui/CurveCard'

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const models: Record<string, ModelSpec> = MODELS

/** y = x², ascending params [0, 0, 1]. */
function sq(id = 'f'): FittedCurve {
  return {
    id,
    modelId: 'poly2',
    params: [0, 0, 1],
    kind: 'explicit',
    domain: null,
    color: '#4f9cf9',
    strokeWidth: 2.5,
    visible: true,
    error: 0,
  }
}

/** y = 2 − x², the other half of the board's own worked example. */
function down(id = 'g'): FittedCurve {
  return { ...sq(id), params: [2, 0, -1], color: '#f0a83c' }
}

/** y = x, so a board can hold three curves that are all functions of x. */
function line(id = 'h'): FittedCurve {
  return { ...sq(id), modelId: 'line', params: [0, 1], color: '#6ee7a8' }
}

/** A circle: on the board, a curve, and NOT a function of x. */
function circle(id = 'c'): FittedCurve {
  return { ...sq(id), modelId: 'circle', params: [0, 0, 2], kind: 'implicit' as const }
}

const nameOf = (c: FittedCurve): string => models[c.modelId]?.name ?? c.modelId

const betweenLink = (over: Partial<AreaLink> = {}): AreaLink => ({
  kind: 'area',
  id: 'L1',
  parentId: 'f',
  otherId: 'g',
  from: -1,
  to: 1,
  abs: BETWEEN_ABS,
  ...over,
})

// ---------------------------------------------------------------------------
// who the region can run to
// ---------------------------------------------------------------------------

describe('area between curves — which second curve', () => {
  it('offers every other curve that is a function of x and on screen', () => {
    const curves = [sq(), down(), line()]
    expect(betweenTargets(curves, models, 'f').map((c) => c.id)).toEqual(['g', 'h'])
  })

  it('never offers the curve itself', () => {
    expect(betweenTargets([sq(), down()], models, 'f').map((c) => c.id)).toEqual(['g'])
  })

  it('skips a hidden curve — a region cannot run to something not on the board', () => {
    const curves = [sq(), { ...down(), visible: false }, line()]
    expect(betweenTargets(curves, models, 'f').map((c) => c.id)).toEqual(['h'])
  })

  it('skips a curve that is not a function of x', () => {
    expect(betweenTargets([sq(), circle()], models, 'f')).toEqual([])
  })
})

describe('area between curves — what the menu item does next', () => {
  it('with exactly one other curve, creates it at once: no pick is armed', () => {
    expect(betweenIntent([sq(), down()], models, 'f')).toEqual({
      act: 'create',
      otherId: 'g',
    })
  })

  it('with two others, arms a pick and says so', () => {
    const intent = betweenIntent([sq(), down(), line()], models, 'f')
    expect(intent.act).toBe('arm')
    expect(intent.act === 'arm' && intent.say).toBe('Tap the second curve.')
  })

  it('with no other curve, refuses in words instead of arming a pick nobody can answer', () => {
    const intent = betweenIntent([sq()], models, 'f')
    expect(intent.act).toBe('refuse')
    expect(intent.act === 'refuse' && intent.say).toMatch(/second curve/i)
  })

  it('a curve that is not a function of x cannot host one at all', () => {
    const intent = betweenIntent([circle(), sq(), down()], models, 'c')
    expect(intent.act).toBe('refuse')
  })

  it('a hidden second curve does not count — one hidden + one shown still creates', () => {
    const curves = [sq(), { ...down(), visible: false }, line()]
    expect(betweenIntent(curves, models, 'f')).toEqual({ act: 'create', otherId: 'h' })
  })

  // Escape, a tap on empty board and a tap back on the same curve are one
  // decision with one sentence: the board must never be left silently armed.
  it('cancelling says so', () => {
    expect(BETWEEN_CANCELLED).toMatch(/no second curve/i)
  })
})

// ---------------------------------------------------------------------------
// what a fresh region is
// ---------------------------------------------------------------------------

describe('area between curves — the link that is created', () => {
  it('defaults to |f − g|, not the signed integral', () => {
    expect(BETWEEN_ABS).toBe(true)
  })

  it('opens on where the curves meet', () => {
    const [from, to] = defaultBetweenBounds(sq(), down(), models, [-4, 4])
    expect(from).toBeCloseTo(-1, 6)
    expect(to).toBeCloseTo(1, 6)
  })

  it('a region whose halves cancel still reads as area, because abs starts on', () => {
    // x² and 2 − x² on [−1, 1] is 8/3; the signed integral over the same
    // interval is −8/3 the other way round. Neither is 0, but the default has
    // to be the one an AP class means by "the area between them".
    const link = betweenLink()
    const cards = cardCalc([link], [sq(), down()], models, nameOf)
    expect(cards.f.areas[0].abs).toBe(true)
    expect(cards.f.areas[0].text).toMatch(/2\.667/)
  })
})

describe('area between curves — the notice it introduces itself with', () => {
  it('names the bounds and says they are where the curves meet', () => {
    expect(betweenNotice(2, -1, 1)).toBe(
      'Shaded between the curves from x = −1 to x = 1 (where they meet)',
    )
  })

  it('trims the zeros a teacher would not have said', () => {
    expect(betweenNotice(2, -1.5, 0.5)).toBe(
      'Shaded between the curves from x = −1.5 to x = 0.5 (where they meet)',
    )
  })

  it('with nothing in view to meet at, names the two chips that fix it', () => {
    expect(betweenNotice(0, -4, 4)).toBe(
      'No intersection in view — drag a and b to set the region',
    )
    expect(betweenNotice(1, -4, 4)).toMatch(/drag a and b/)
  })
})

// ---------------------------------------------------------------------------
// deletion
// ---------------------------------------------------------------------------

describe('area between curves — deleting either curve', () => {
  const links: CalcLink[] = [betweenLink()]

  it('deleting the parent takes the region', () => {
    expect([...dependentsOf(links, ['f']).linkIds]).toEqual(['L1'])
  })

  it('deleting the OTHER curve takes it too — it is half the region', () => {
    expect([...dependentsOf(links, ['g']).linkIds]).toEqual(['L1'])
  })

  it('deleting an unrelated curve takes nothing', () => {
    expect([...dependentsOf(links, ['h']).linkIds]).toEqual([])
  })

  it('the toast calls it a shaded area', () => {
    expect(linkNoun('area')).toBe('shaded area')
  })
})

// ---------------------------------------------------------------------------
// what the cards are handed
// ---------------------------------------------------------------------------

describe('area between curves — what each card is told', () => {
  it('offers the menu item only when there is a second curve to point at', () => {
    const alone = betweenCardInfo([sq()], models, [], nameOf)
    expect(alone.f.canAdd).toBe(false)
    const pair = betweenCardInfo([sq(), down()], models, [], nameOf)
    expect(pair.f.canAdd).toBe(true)
    expect(pair.g.canAdd).toBe(true)
  })

  it('does not offer it beside a hidden second curve', () => {
    const info = betweenCardInfo([sq(), { ...down(), visible: false }], models, [], nameOf)
    expect(info.f.canAdd).toBe(false)
  })

  it('never offers it on a curve that is not a function of x', () => {
    const info = betweenCardInfo([circle(), sq(), down()], models, [], nameOf)
    expect(info.c.canAdd).toBe(false)
  })

  it('tells the OTHER curve why it is shaded, and whose card owns it', () => {
    const info = betweenCardInfo([sq(), down()], models, [betweenLink()], nameOf)
    expect(info.g.notes).toHaveLength(1)
    expect(info.g.notes[0]).toContain('area between this and')
    expect(info.g.notes[0]).toContain(nameOf(sq()))
    expect(info.g.notes[0]).toMatch(/see .+ card/)
    // The card that OWNS it gets the row, not the note.
    expect(info.f.notes).toEqual([])
  })

  it('says nothing about an ordinary area against the axis', () => {
    const axis: CalcLink = { kind: 'area', id: 'L2', parentId: 'f', from: 0, to: 2, abs: false }
    const info = betweenCardInfo([sq(), down()], models, [axis], nameOf)
    expect(info.g.notes).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// the card itself
// ---------------------------------------------------------------------------

const NOOP = (): void => {}

/** The whole card, rendered. Everything not under test is a no-op. */
function renderCard(
  curve: FittedCurve,
  links: CalcLink[],
  curves: FittedCurve[],
  over: Record<string, unknown> = {},
): string {
  const calc = cardCalc(links, curves, models, nameOf)[curve.id]
  const between = betweenCardInfo(curves, models, links, nameOf)[curve.id]
  const props = {
    curve,
    models,
    selected: true,
    candidates: [],
    snapMask: null,
    snapKey: 0,
    shaking: false,
    edited: false,
    analysis: [],
    onAnalysisHover: NOOP,
    onFeatureEdit: () => false,
    onSelect: NOOP,
    onDelete: NOOP,
    onDuplicate: NOOP,
    onToggleVisible: NOOP,
    onCycleColor: NOOP,
    onParamChange: NOOP,
    onParamEditStart: NOOP,
    onParamEditEnd: NOOP,
    onParamCommit: NOOP,
    onParamSetExact: NOOP,
    onApplyCandidate: NOOP,
    onEquationCommit: () => null,
    onStrokeWidth: NOOP,
    onDash: NOOP,
    onEnds: NOOP,
    onOpacity: NOOP,
    calc,
    between,
    onAddCalc: NOOP,
    onAddAreaBetween: NOOP,
    onCalcChange: NOOP,
    onCalcRemove: NOOP,
    ...over,
  }
  // The card takes far more props than any one assertion is about; the shape
  // is checked by tsc where the App actually builds it.
  return renderToStaticMarkup(
    createElement(CurveCard, props as unknown as Parameters<typeof CurveCard>[0]),
  )
}

describe('area between curves — the parent card', () => {
  const curves = [sq(), down()]

  it('names both curves on the first line', () => {
    const html = renderCard(sq(), [betweenLink()], curves)
    expect(html).toContain('Between')
    expect(html).toContain(`${nameOf(sq())} and ${nameOf(down())}`)
  })

  it('prints the readout under it', () => {
    const html = renderCard(sq(), [betweenLink()], curves)
    expect(html).toMatch(/2\.667/)
  })

  it('still has the a and b chips', () => {
    const html = renderCard(sq(), [betweenLink()], curves)
    expect(html).toContain('>a<')
    expect(html).toContain('>b<')
  })

  it('the |area| chip becomes |f − g| / signed', () => {
    const on = renderCard(sq(), [betweenLink()], curves)
    expect(on).toContain('|f − g|')
    expect(on).not.toContain('|area|')
    const off = renderCard(sq(), [betweenLink({ abs: false })], curves)
    expect(off).toContain('>signed<')
    expect(off).not.toContain('|area|')
  })

  it('an ordinary area against the axis is untouched', () => {
    const axis: CalcLink = { kind: 'area', id: 'L2', parentId: 'f', from: 0, to: 2, abs: false }
    const html = renderCard(sq(), [axis], curves)
    expect(html).toContain('|area|')
    expect(html).toContain('>Area<')
    expect(html).not.toContain('>Between<')
  })
})

describe('area between curves — the other curve’s card', () => {
  const curves = [sq(), down()]

  it('says why it is shaded and whose card owns it, with no controls of its own', () => {
    const html = renderCard(down(), [betweenLink()], curves)
    expect(html).toContain('area between this and')
    expect(html).toContain(nameOf(sq()))
    // One object, one set of limits: the far side offers no a/b and no ×.
    expect(html).not.toContain('calc-field-label')
    expect(html).not.toContain('calc-drop')
  })

  it('a card with nothing to do with any region says nothing at all', () => {
    const html = renderCard(line(), [betweenLink()], [...curves, line()])
    expect(html).not.toContain('area between this and')
    expect(html).not.toContain('calc-section')
  })
})

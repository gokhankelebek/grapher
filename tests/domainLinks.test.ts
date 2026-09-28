// ============================================================================
// tests/domainLinks.test.ts — the Domain section's text and rules
// (src/ui/domainLinks.ts), the board switches in the document (ghost, hlt,
// reflect in board.curveViews), and the two overlay kinds they draw.
//
// Sets and one-to-one facts are HAND-MADE here (RealSet / OneToOne values),
// so these tests pin the UI's rules independently of the core's scan.
// ============================================================================

import { describe, it, expect } from 'vitest'
import type { FitResult, FittedCurve, Viewport } from '../src/core/types'
import { DARK_THEME, FIGURE_STYLES } from '../src/core/types'
import type { IntervalPart, OneToOne, RealSet } from '../src/core/domainRange'
import { parseExpression } from '../src/core/parse'
import {
  deserializeDoc,
  docFromBoard,
  serializeDoc,
  type BoardInput,
  type CurveViews,
  type DocMeta,
  type StoredDoc,
} from '../src/core/persist'
import {
  collectCurveViews,
  emptyViewStates,
  patchLens,
  pruneViewStates,
  restoreViewStates,
  viewStatesFrom,
} from '../src/ui/curveViews'
import {
  HLT_FAIL_COLOR,
  HLT_PASS_COLOR,
  MAX_CHIPS,
  conditionText,
  draftOf,
  endText,
  explicitF,
  familyF,
  hltStart,
  hltVerdict,
  inVariable,
  inverseCurveLine,
  inverseRestriction,
  oneToOneChips,
  oneToOneText,
  parserSpelling,
  partBuilder,
  partInterval,
  partRestriction,
  probeX,
  readRestriction,
  reflectProbe,
  restrictedLine,
  sameSet,
  setRowText,
  singleProperInterval,
  sketchDomain,
  splitTyped,
} from '../src/ui/domainLinks'
import { MODELS } from '../src/core/fit/models'
import { renderBoard, type BoardScene, type Overlay } from '../src/ui/renderBoard'
import { MockCtx, withMockPath2D } from './mockCanvas'

// ---------------------------------------------------------------------------
// hand-made sets
// ---------------------------------------------------------------------------

const PI = Math.PI
const part = (
  lo: number,
  hi: number,
  loClosed = Number.isFinite(lo),
  hiClosed = Number.isFinite(hi),
  loExact: string | null = null,
  hiExact: string | null = null,
): IntervalPart => ({
  lo,
  hi,
  loClosed,
  hiClosed,
  loExact: loExact === null ? null : { text: loExact, tex: loExact, value: lo },
  hiExact: hiExact === null ? null : { text: hiExact, tex: hiExact, value: hi },
})

const set = (parts: IntervalPart[], text = '', builder = ''): RealSet => ({
  kind: 'intervals',
  parts,
  text,
  tex: '',
  builder,
  builderTex: '',
})

const ALL = set([part(-Infinity, Infinity)], '(−∞, ∞)', 'all real numbers')
const NONNEG = set([part(0, Infinity)], '[0, ∞)', 'x ≥ 0')

// ---------------------------------------------------------------------------
// numbers in both spellings
// ---------------------------------------------------------------------------

describe('exact ends, for the card and for the line', () => {
  it('rewrites Unicode exact forms in the parser’s own spelling', () => {
    expect(parserSpelling('−π/2', -PI / 2)).toBe('-pi/2')
    expect(parserSpelling('√2', Math.SQRT2)).toBe('sqrt(2)')
    expect(parserSpelling('2√3/9', (2 * Math.sqrt(3)) / 9)).toBe('2sqrt(3)/9')
    expect(parserSpelling('3π/2', (3 * PI) / 2)).toBe('3pi/2')
    // a form that does not read back as its value is refused
    expect(parserSpelling('π/2', 1)).toBeNull()
  })

  it('writes an end exactly when it can, and as a decimal the parser reads when not', () => {
    expect(endText(-PI / 2, null)).toEqual({ show: '−π/2', line: '-pi/2' })
    expect(endText(0, null)).toEqual({ show: '0', line: '0' })
    const odd = endText(0.123456789123, null)
    expect(odd.show).toBe('0.1235')
    expect(Number(odd.line)).toBeCloseTo(0.123456789123, 11)
  })
})

describe('a stretch of x, as a teacher writes it', () => {
  it('set-builder for one interval', () => {
    expect(partBuilder(part(0, Infinity))).toBe('x ≥ 0')
    expect(partBuilder(part(-Infinity, 0))).toBe('x ≤ 0')
    expect(partBuilder(part(0, Infinity, false))).toBe('x > 0')
    expect(partBuilder(part(-PI / 2, PI / 2))).toBe('−π/2 ≤ x ≤ π/2')
    expect(partBuilder(part(-2, 3, false, true))).toBe('−2 < x ≤ 3')
    expect(partBuilder(part(-Infinity, Infinity))).toBe('all real numbers')
    expect(partBuilder(part(2, Infinity), 'y')).toBe('y ≥ 2')
  })

  it('interval notation for one interval — ∞ never closed', () => {
    expect(partInterval(part(0, Infinity))).toBe('[0, ∞)')
    expect(partInterval(part(-Infinity, 2, false, false))).toBe('(−∞, 2)')
    expect(partInterval(part(-PI / 2, PI / 2, true, false))).toBe('[−π/2, π/2)')
  })

  it('restates a set in another variable (f’s range is f⁻¹’s domain, in x)', () => {
    const range = set([part(2, Infinity)], '[2, ∞)', 'y ≥ 2')
    const asDomain = inVariable(range, 'x')!
    expect(asDomain.builder).toMatch(/x ≥ 2/)
    expect(asDomain.parts).toEqual(range.parts)
    // a discrete set keeps its words
    const finite: RealSet = { kind: 'finite', parts: [], points: [-1, 0, 1], text: '{−1, 0, 1}', tex: '', builder: '{−1, 0, 1}', builderTex: '' }
    expect(inVariable(finite, 'x')).toBe(finite)
    expect(inVariable(null, 'x')).toBeNull()
  })

  it('a row is "—" (null) for no answer and for kind unknown', () => {
    expect(setRowText(null, 'interval')).toBeNull()
    const unknown: RealSet = { kind: 'unknown', parts: [], text: '', tex: '', builder: '', builderTex: '' }
    expect(setRowText(unknown, 'builder')).toBeNull()
    expect(setRowText(NONNEG, 'interval')).toBe('[0, ∞)')
    expect(setRowText(NONNEG, 'builder')).toBe('x ≥ 0')
  })
})

// ---------------------------------------------------------------------------
// restrictions in a typed line
// ---------------------------------------------------------------------------

describe('restrictions, written into a typed line', () => {
  it('splits a line into its body and its restriction', () => {
    expect(splitTyped('y = x^2')).toEqual({ base: 'y = x^2', cond: null })
    expect(splitTyped('y = x^2 {0 <= x < 3}')).toEqual({ base: 'y = x^2', cond: '0 <= x < 3' })
    expect(splitTyped('f(x) = sqrt(x) for x > 1')).toEqual({ base: 'f(x) = sqrt(x)', cond: 'x > 1' })
    expect(splitTyped('y = x^2, x > 0')).toEqual({ base: 'y = x^2', cond: 'x > 0' })
    expect(splitTyped('y = { x^2 if x < 0 ; 2x if x >= 0 }')).toBe('piecewise')
    expect(splitTyped('')).toBeNull()
  })

  it('writes the restriction clause the parser reads — and replaces an old one', () => {
    const r = readRestriction({ lo: { text: '0', closed: true }, hi: { text: '', closed: true } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(restrictedLine('y = x^2', r.r)).toBe('y = x^2 {x >= 0}')
    expect(restrictedLine('y = x^2 {-5 < x < 5}', r.r)).toBe('y = x^2 {x >= 0}')
    const two = readRestriction({ lo: { text: '-2', closed: false }, hi: { text: '3', closed: true } })
    if (!two.ok) throw new Error('unreadable')
    expect(restrictedLine('y = x^2', two.r)).toBe('y = x^2 {-2 < x <= 3}')
    // cleared: the body alone
    expect(restrictedLine('y = x^2 {x >= 0}', { lo: null, hi: null })).toBe('y = x^2')
    // a piecewise takes none
    expect(restrictedLine('y = { x if x < 0 ; 1 if x >= 0 }', two.r)).toBeNull()
  })

  it('every restricted line it writes parses, and draws only on the restriction', () => {
    const lines = [
      restrictedLine('y = x^2', partRestriction(part(0, Infinity)))!,
      restrictedLine('y = sin(x)', partRestriction(part(-PI / 2, PI / 2, true, true, '−π/2', 'π/2')))!,
      restrictedLine('y = x^2', partRestriction(part(-Infinity, 0)))!,
      restrictedLine('y = sqrt(x)', partRestriction(part(Math.SQRT2, 4, false, true)))!,
    ]
    expect(lines[0]).toBe('y = x^2 {x >= 0}')
    expect(lines[1]).toBe('y = sin(x) {-pi/2 <= x <= pi/2}')
    expect(lines[2]).toBe('y = x^2 {x <= 0}')
    expect(lines[3]).toBe('y = sqrt(x) {sqrt(2) < x <= 4}')
    for (const src of lines) {
      const o = parseExpression(src)
      expect(o.ok, src).toBe(true)
      if (!o.ok) continue
      const m = o.plot.makeModel('t')
      // what the board draws: the model, inside the plot's own domain
      const dom = o.plot.domain
      const at = (x: number) =>
        dom && (x < dom[0] || x > dom[1]) ? Number.NaN : m.evalExplicit!(o.plot.defaultParams, x)
      if (src.includes('x >= 0')) {
        expect(at(-1)).toBeNaN()
        expect(at(2)).toBeCloseTo(4)
      }
      if (src.includes('sin')) {
        expect(at(PI / 2)).toBeCloseTo(1)
        expect(at(2)).toBeNaN()
      }
      if (src.includes('sqrt(2) <')) {
        expect(at(1)).toBeNaN()
        expect(at(4)).toBeCloseTo(2)
      }
    }
  })

  it('reads the editor’s bounds: exact text, ∞ as blank, lo < hi', () => {
    const r = readRestriction({ lo: { text: '-pi/2', closed: true }, hi: { text: 'π/2', closed: false } })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.r.lo!.value).toBeCloseTo(-PI / 2)
      expect(r.r.hi!.line).toBe('pi/2')
      expect(r.r.hi!.closed).toBe(false)
    }
    const inf = readRestriction({ lo: { text: '−∞', closed: true }, hi: { text: 'sqrt(2)', closed: true } })
    expect(inf.ok && inf.r.lo === null && Math.abs(inf.r.hi!.value - Math.SQRT2) < 1e-12).toBe(true)
    const bad = readRestriction({ lo: { text: 'banana', closed: true }, hi: { text: '', closed: true } })
    expect(bad.ok).toBe(false)
    const backwards = readRestriction({ lo: { text: '3', closed: true }, hi: { text: '1', closed: true } })
    expect(backwards.ok).toBe(false)
    const point = readRestriction({ lo: { text: '1', closed: true }, hi: { text: '1', closed: true } })
    expect(point.ok).toBe(false)
  })

  it('writes one-sided and two-sided conditions', () => {
    expect(conditionText({ lo: { value: 1, line: '1', closed: false }, hi: null })).toBe('x > 1')
    expect(conditionText({ lo: null, hi: { value: 1, line: '1', closed: false } })).toBe('x < 1')
    expect(conditionText({ lo: null, hi: null })).toBeNull()
  })

  it('prefills the editor from the current restriction', () => {
    expect(draftOf(null)).toEqual({ lo: { text: '', closed: true }, hi: { text: '', closed: true } })
    expect(draftOf(part(-PI / 2, PI / 2, true, false))).toEqual({
      lo: { text: '-pi/2', closed: true },
      hi: { text: 'pi/2', closed: false },
    })
  })

  it('a sketch’s domain: two finite numbers, an open side keeps where the sketch stops', () => {
    const r = { lo: { value: 0, line: '0', closed: true }, hi: null }
    expect(sketchDomain(r, [-3, 3], [-10, 10])).toEqual([0, 3])
    expect(sketchDomain(r, null, [-10, 10])).toEqual([0, 10])
    expect(sketchDomain({ lo: { value: 5, line: '5', closed: true }, hi: null }, [-3, 3], [-10, 10])).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// one-to-one
// ---------------------------------------------------------------------------

const SQUARE: OneToOne = {
  oneToOne: false,
  witness: { y: 1, exactY: { text: '1', tex: '1', value: 1 }, xs: [-1, 1] },
  monotone: [part(0, Infinity), part(-Infinity, 0)],
}
const SINE: OneToOne = {
  oneToOne: false,
  witness: { y: 0.5, exactY: { text: '1/2', tex: '\\frac12', value: 0.5 }, xs: [PI / 6, (5 * PI) / 6] },
  monotone: [
    part(-PI / 2, PI / 2, true, true, '−π/2', 'π/2'),
    part(PI / 2, (3 * PI) / 2, true, true, 'π/2', '3π/2'),
    part((-3 * PI) / 2, -PI / 2, true, true, '−3π/2', '−π/2'),
    part((3 * PI) / 2, (5 * PI) / 2, true, true, '3π/2', '5π/2'),
    part((-5 * PI) / 2, (-3 * PI) / 2, true, true, '−5π/2', '−3π/2'),
  ],
}

describe('one-to-one', () => {
  it('says why it fails, with the witness', () => {
    expect(oneToOneText(SQUARE)).toBe('No — fails at y = 1 (x = −1, 1)')
    expect(oneToOneText({ oneToOne: true, monotone: [] })).toBe('Yes')
    expect(oneToOneText(null)).toBeNull()
    // a periodic witness: three x's and an ellipsis
    expect(oneToOneText({ ...SINE, witness: { y: 0, exactY: null, xs: [-PI, 0, PI, 2 * PI, 3 * PI] } })).toBe(
      'No — fails at y = 0 (x = −π, 0, π, …)',
    )
  })

  it('offers the widest stretches as chips, at most four, in exact text', () => {
    expect(oneToOneChips(SQUARE).map((c) => c.label)).toEqual(['x ≥ 0', 'x ≤ 0'])
    const sin = oneToOneChips(SINE)
    expect(sin.length).toBe(MAX_CHIPS)
    expect(sin[0].label).toBe('−π/2 ≤ x ≤ π/2')
    expect(oneToOneChips({ oneToOne: true, monotone: [part(-1, 1)] })).toEqual([])
  })

  it('a chip is exactly the line a teacher would type', () => {
    const chip = oneToOneChips(SINE)[0]
    expect(restrictedLine('y = sin(x)', partRestriction(chip.part))).toBe('y = sin(x) {-pi/2 <= x <= pi/2}')
  })
})

// ---------------------------------------------------------------------------
// the inverse
// ---------------------------------------------------------------------------

describe('the stretch f⁻¹ inverts, and f⁻¹ as its own curve', () => {
  it('is the curve domain when the teacher chose one interval, null on the natural domain', () => {
    expect(inverseRestriction(NONNEG, ALL)).toEqual(NONNEG.parts[0])
    expect(inverseRestriction(NONNEG, NONNEG)).toBeNull()
    expect(inverseRestriction(ALL, ALL)).toBeNull()
    const two = set([part(-Infinity, 0, false, false), part(0, Infinity, false, false)])
    expect(inverseRestriction(two, two)).toBeNull()
    expect(inverseRestriction(null, null)).toBeNull()
  })

  it('compares sets end by end, closedness included', () => {
    expect(sameSet(NONNEG, set([part(0, Infinity)]))).toBe(true)
    expect(sameSet(NONNEG, set([part(0, Infinity, false)]))).toBe(false)
    expect(singleProperInterval(ALL)).toBeNull()
    expect(singleProperInterval(NONNEG)).toEqual(NONNEG.parts[0])
  })

  it('restricts the typed inverse to f’s range when that is one proper interval', () => {
    // f = √(x − 2): range [0, ∞) → f⁻¹ = x² + 2 on x ≥ 0
    expect(inverseCurveLine('y = x^2 + 2', NONNEG)).toBe('y = x^2 + 2 {x >= 0}')
    // all of ℝ: nothing to add
    expect(inverseCurveLine('y = (x - 1)/2', ALL)).toBe('y = (x - 1)/2')
    // two pieces (y ≠ 2): the formula already says it
    const yNot2 = set([part(-Infinity, 2, false, false), part(2, Infinity, false, false)])
    expect(inverseCurveLine('y = (3x + 1)/(x - 2)', yNot2)).toBe('y = (3x + 1)/(x - 2)')
    expect(inverseCurveLine('y = sqrt(x)', null)).toBe('y = sqrt(x)')
  })
})

// ---------------------------------------------------------------------------
// the horizontal line test and the probe
// ---------------------------------------------------------------------------

describe('the horizontal line test', () => {
  it('fails at two or more crossings and passes at one or none', () => {
    expect(hltVerdict([-1, 1])).toMatchObject({ count: 2, fails: true, chip: '2 points — not one-to-one', color: HLT_FAIL_COLOR })
    expect(hltVerdict([-1, 0, 1])).toMatchObject({ count: 3, fails: true, chip: '3 points — not one-to-one' })
    expect(hltVerdict([2])).toMatchObject({ count: 1, fails: false, chip: '1 point', color: HLT_PASS_COLOR })
    expect(hltVerdict([])).toMatchObject({ count: 0, fails: false, chip: 'no points' })
  })

  it('starts at the witness, else f(0), else the middle of the view', () => {
    expect(hltStart(SQUARE, 0, 5)).toBe(1)
    expect(hltStart({ oneToOne: true, monotone: [] }, 3, 5)).toBe(3)
    expect(hltStart(null, Number.NaN, 5)).toBe(5)
  })
})

const SQ: FittedCurve = {
  id: 'sq', modelId: 'poly2', params: [0, 0, 1], kind: 'explicit', domain: [0, 2],
  color: '#4f9cf9', strokeWidth: 2.5, visible: true, error: 0,
}

describe('the reflected point', () => {
  it('is (a, f(a)) and (f(a), a) — the segment is perpendicular to y = x', () => {
    const f = familyF(SQ, MODELS)!
    const pr = reflectProbe(f, 1.5)!
    expect(pr.p).toEqual({ x: 1.5, y: 2.25 })
    expect(pr.q).toEqual({ x: 2.25, y: 1.5 })
    const dx = pr.q.x - pr.p.x
    const dy = pr.q.y - pr.p.y
    // perpendicular to (1, 1), and its midpoint is on y = x
    expect(dx + dy).toBeCloseTo(0)
    expect((pr.p.x + pr.q.x) / 2).toBeCloseTo((pr.p.y + pr.q.y) / 2)
  })

  it('a curve’s own domain is respected, and a dragged probe stays on f', () => {
    const f = explicitF(SQ, MODELS)!
    expect(f(3)).toBeNaN()
    expect(reflectProbe(f, 3)).toBeNull()
    expect(probeX(f, 3, 0.01)).toBeCloseTo(2, 1)
    expect(familyF(SQ, MODELS)!(3)).toBe(9)
  })
})

// ---------------------------------------------------------------------------
// the document: ghost, hlt, reflect in board.curveViews
// ---------------------------------------------------------------------------

function curve(id: string): FittedCurve {
  return { ...SQ, id, domain: null }
}
function board(over: Partial<BoardInput> = {}): BoardInput {
  return {
    curves: [curve('c1'), curve('c2'), curve('c3')],
    styles: {},
    candidates: new Map<string, FitResult[]>(),
    exprSources: {},
    viewport: { center: { x: 0, y: 0 }, pxPerUnit: 60 },
    selectedId: null,
    mode: 'draw',
    ...over,
  }
}
const META: DocMeta = { id: 'doc1', name: 'Lesson', createdAt: 1000, modifiedAt: 1000 }
const save = (input: BoardInput): string => serializeDoc(docFromBoard(META, input, 2000))

describe('the board switches in the document', () => {
  const VIEWS: CurveViews = {
    c1: { ghost: true, hlt: 1.5 },
    c2: { reflect: -0.75 },
    c3: { showParent: true, hlt: 0 },
  }

  it('round-trip: ghost, the line’s height and the probe’s a', () => {
    const back = deserializeDoc(save(board({ curveViews: VIEWS })))
    expect(back.degraded).toBe(false)
    expect(back.board!.curveViews).toEqual(VIEWS)
  })

  it('writes only what is on — and a board without them is byte-identical', () => {
    const before = save(board())
    expect(save(board({ curveViews: { c1: {} } }))).toBe(before)
    const raw = JSON.parse(save(board({ curveViews: VIEWS }))) as StoredDoc
    expect(raw.board.curveViews!.c1).toEqual({ ghost: true, hlt: 1.5 })
    expect(raw.board.curveViews!.c2).toEqual({ reflect: -0.75 })
  })

  it('drops and reports a bad value, keeping the rest of the entry', () => {
    const raw = JSON.parse(save(board({ curveViews: VIEWS }))) as StoredDoc
    const v = raw.board.curveViews as unknown as Record<string, Record<string, unknown>>
    v.c1.ghost = 'yes'
    v.c2.reflect = 'a'
    v.c3.hlt = null
    const res = deserializeDoc(JSON.stringify(raw))
    expect(res.degraded).toBe(true)
    expect(res.problems.join(' ')).toMatch(/could not all be read/)
    expect(res.board!.curveViews).toEqual({ c1: { hlt: 1.5 }, c3: { showParent: true } })
  })

  it('the App side: the lens map collects, restores, prunes and comes back on undo', () => {
    const s = emptyViewStates()
    s.lens = patchLens(s.lens, 'c1', { ghost: true, hlt: 1.5 })
    s.lens = patchLens(s.lens, 'c2', { reflect: -0.75 })
    s.showParent.c3 = true
    s.lens = patchLens(s.lens, 'c3', { hlt: 0 })
    expect(collectCurveViews(s)).toEqual(VIEWS)
    const curves = [curve('c1'), curve('c2'), curve('c3')]
    expect(viewStatesFrom(VIEWS, curves).lens).toEqual({
      c1: { ghost: true, hlt: 1.5 },
      c2: { reflect: -0.75 },
      c3: { hlt: 0 },
    })
    const pruned = pruneViewStates(s, new Set(['c1', 'c3']))
    expect(Object.keys(pruned.lens)).toEqual(['c1', 'c3'])
    // c2 comes back through undo with its probe
    const back = restoreViewStates(pruned, VIEWS, new Set(['c1', 'c3']), curves)
    expect(back.lens.c2).toEqual({ reflect: -0.75 })
  })

  it('patchLens clears a field with null / false and hands back the same map when nothing changed', () => {
    let m = patchLens({}, 'c1', { hlt: 2 })
    expect(m).toEqual({ c1: { hlt: 2 } })
    expect(patchLens(m, 'c1', { hlt: 2 })).toBe(m)
    m = patchLens(m, 'c1', { ghost: true })
    m = patchLens(m, 'c1', { hlt: null })
    expect(m).toEqual({ c1: { ghost: true } })
    m = patchLens(m, 'c1', { ghost: false })
    expect(m).toEqual({})
    expect(patchLens(m, 'c1', { ghost: false })).toBe(m)
  })
})

// ---------------------------------------------------------------------------
// the overlays: the ghost under the curves, the line and its dots on top,
// mono ink under SAT / AP
// ---------------------------------------------------------------------------

const VP: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 60, widthPx: 600, heightPx: 400 }

/** A MockCtx that keeps every stroke in order, with its style, dash and alpha. */
class OpCtx extends MockCtx {
  ops: { style: string; dash: number[]; alpha: number }[] = []
  stroke(path?: Parameters<MockCtx['stroke']>[0]): void {
    super.stroke(path)
    this.ops.push({ style: this.strokeStyle, dash: this.lineDash.slice(), alpha: this.globalAlpha })
  }
}

function paint(overlays: Overlay[], figure?: BoardScene['figure'], curves: FittedCurve[] = [SQ]): OpCtx {
  const ctx = new OpCtx()
  withMockPath2D(() =>
    renderBoard(ctx as unknown as CanvasRenderingContext2D, {
      vp: VP,
      theme: figure ? figure.theme : DARK_THEME,
      curves,
      styles: {},
      models: MODELS,
      overlays,
      ...(figure ? { figure } : {}),
      chrome: null,
    }),
  )
  return ctx
}

describe('the Domain section’s overlays', () => {
  it('draws the ghost dashed and faint in the curve’s colour, before the curve itself', () => {
    const ghost: Overlay = { kind: 'ghost', curveId: 'sq', f: (x) => x * x }
    const ctx = paint([ghost])
    const inColour = ctx.ops.filter((o) => o.style.toLowerCase() === SQ.color.toLowerCase())
    expect(inColour.length).toBeGreaterThanOrEqual(2)
    // the first stroke in the curve's colour is the ghost: dashed, faint
    expect(inColour[0].dash.length).toBeGreaterThan(0)
    expect(inColour[0].alpha).toBeLessThan(1)
    // the curve's own stroke comes after it, solid
    expect(inColour[inColour.length - 1].dash.length).toBe(0)
  })

  it('draws the horizontal line across the board, in the colour it is given, over the curve', () => {
    const ctx = paint([{ kind: 'hline', y: 1, color: HLT_FAIL_COLOR }])
    const at = ctx.ops.findIndex((o) => o.style === HLT_FAIL_COLOR)
    const curve = ctx.ops.findIndex((o) => o.style.toLowerCase() === SQ.color.toLowerCase())
    expect(at).toBeGreaterThan(curve)
    expect(ctx.ops.filter((o) => o.style === HLT_FAIL_COLOR).length).toBe(1)
  })

  it('goes mono under SAT, like every other figure mark', () => {
    const sat = FIGURE_STYLES.sat
    const ctx = paint(
      [
        { kind: 'hline', y: 1, color: HLT_FAIL_COLOR },
        { kind: 'ghost', curveId: 'sq', f: (x) => x * x },
      ],
      sat,
    )
    const colours = new Set(ctx.ops.map((o) => o.style))
    expect(colours.has(HLT_FAIL_COLOR)).toBe(false)
    expect(colours.has(SQ.color)).toBe(false)
    const ghost = ctx.ops.find((o) => o.dash.length > 0 && o.alpha < 1)
    expect(ghost?.style).toBe(sat.theme.axis)
  })

  it('an empty overlay list draws exactly what no overlays drew', () => {
    const a = paint([])
    const ctx = new OpCtx()
    withMockPath2D(() =>
      renderBoard(ctx as unknown as CanvasRenderingContext2D, {
        vp: VP, theme: DARK_THEME, curves: [SQ], styles: {}, models: MODELS, chrome: null,
      }),
    )
    expect(a.ops).toEqual(ctx.ops)
  })
})

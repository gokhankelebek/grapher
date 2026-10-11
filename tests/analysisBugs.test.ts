// ============================================================================
// tests/analysisBugs.test.ts — regressions for analysis bugs found while
// writing gallery examples:
//
//   1. oneToOneInfo((e^(2x) − 1)/sin x) never returned (a `p++` walk over
//      integers past 2^53); every analysis entry point must now finish fast
//      on nasty formulas — run in a child process so a hang is KILLED;
//   2. an asymptote is written on its own merit (y = 2/π), never rounded
//      against the curve's height to "y = 0";
//   3. a removable 0/0 of higher order is a hole, read off the Taylor jet:
//      (eˣ − 1 − x)/x² → 1/2, (1 − cos x)/x² → 1/2, (sin x − x)/x³ → −1/6;
//   4. key points lie in the domain, and a real y is not rounded to 0 by an
//      explosive curve's scale;
//   5. the answer key rounds a point exactly as the board's chip does;
//   6. a parametric curve's extremes stay inside its t-interval, a polar
//      curve's tips inside its θ window.
// ============================================================================

import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import type { FittedCurve, ModelSpec, SpecialPoint } from '../src/core/types'
import { parseExpression } from '../src/core/parse'
import { MODELS } from '../src/core/fit/models'
import { analyzeCurve } from '../src/core/analyze'
import { oneToOneInfo } from '../src/core/domainRange'
import { asymptoteForm, findAsymptotes, findHoles, findPoles } from '../src/core/holes'
import { asymptoteTexts } from '../src/ui/CurveCard'
import { curveScale, pointScale } from '../src/ui/curveState'
import { pointText } from '../src/ui/numeric'
import { boardLabelScale, boardPointText } from '../src/ui/renderBoard'
import { buildExample, exampleById } from '../src/examples'
import type { ExampleDef } from '../src/examples'
import { docModelFromJSON } from '../src/ui/docScene'
import { docAnswerLines } from '../src/ui/docAnswers'
import { describeBoard } from '../src/ui/boardDescription'
import { PERF } from './perfBudget'

let seq = 0
function typed(src: string): { curve: FittedCurve; models: Record<string, ModelSpec>; spec: ModelSpec } {
  const r = parseExpression(src)
  if (!r.ok) throw new Error(`expected "${src}" to parse: ${r.error}`)
  const id = `bug_${++seq}`
  const spec = r.plot.makeModel(id)
  const curve: FittedCurve = {
    id: `c${seq}`, modelId: id, params: r.plot.defaultParams, kind: r.plot.kind,
    domain: r.plot.domain, color: '#4f9cf9', strokeWidth: 2.5, visible: true, error: 0,
  }
  return { curve, models: { [id]: spec }, spec }
}

const points = (src: string): SpecialPoint[] => {
  const t = typed(src)
  return analyzeCurve(t.curve, t.models)
}

// ---------------------------------------------------------------------------
// 1. no hang, and a time budget on every entry point
// ---------------------------------------------------------------------------

const NASTY = [
  'y = (e^(2x) - 1)/sin(x)', // the hang
  'y = (e^(2x) - 1)/arctan(x)',
  'y = (e^(2x) - 1)/ln(1 + x)',
  'y = (e^(3x) - 1)/tan(x)',
  'y = (e^(10x) - 1)/sin(10x)',
  'y = e^x/sin(x)',
  'y = e^(x^2)/cos(x)',
  'y = cosh(x)/sin(x)',
  'y = ln(x)/sin(x)',
  'y = sin(x)/ln(x)',
  'y = e^(2x)/sin(x)^2',
  'y = (e^(2x) - 1)/(x sin(x))',
  'y = sin(1/x)',
  'y = x sin(1/x)',
  'y = 1/tan(1/x)',
  'y = x^x',
  'y = x^(1/x)',
  'y = sin(x)^x',
  'y = x^sin(x)',
  'y = tan(x)/x',
  'y = tan(e^x)',
  'y = sin(e^x)',
  'y = e^(e^x)',
  'y = e^(1/x)',
  'y = e^(-1/x^2)',
  'y = (e^x - 1 - x)/x^2',
  'y = (1 - cos(x))/x^2',
  'y = (sin(x) - x)/x^3',
  'y = sin(50x)/x',
  'y = sin(x^2)/x',
  'y = floor(x)/x',
  'y = floor(1/x)',
  'y = ln(sin(x))',
  'y = tan(x)^2/sin(x)',
  // the second round (tests/analysisEnds.test.ts): overflowing ends, open
  // ends, periodic exclusions with extra points, slow logarithmic ends
  'y = e^x/(e^x + 7)',
  'y = e^x/(1 + e^x)',
  'y = (2e^x + 3)/(e^x - 1)',
  'y = x/e^x',
  'y = x ln(x)',
  'y = x^x',
  'y = sec(x)/x',
  'y = 1/(x sin(x))',
  'y = tan(x)/(x - 100)',
  'y = tan(x)/(x^2 - 1)',
  'y = tan(x) + tan(sqrt(2)x)',
  'y = 1/ln(x)',
  'y = sqrt(x)/ln(x)',
]

/**
 * The numbers a domain or range text states, as numbers: "(−∞, −1301000) ∪ …"
 * → [1301000, …]. Exact forms (π/2, √3) contribute their digits only, which
 * are small.
 */
function statedNumbers(text: string): number[] {
  return (text.replace(/−/g, '-').match(/\d+(?:\.\d+)?(?:e[+-]?\d+)?/g) ?? []).map(Number)
}

describe('every analysis entry point finishes on nasty formulas', () => {
  it('in a child process, under 500 ms per call (the 400 ms backstop plus margin) — a hang is killed, not waited on', () => {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const root = path.resolve(here, '..')
    const res = spawnSync(
      process.execPath,
      [path.join(root, 'node_modules/vite-node/vite-node.mjs'), path.join(here, 'fixtures/analysisFuzz.ts'), JSON.stringify(NASTY)],
      { cwd: root, encoding: 'utf8', timeout: 90_000 * PERF, killSignal: 'SIGKILL' },
    )
    // a hang is a kill by the timeout: status null, signal SIGKILL
    expect(res.signal, `the analysis hung (stderr: ${res.stderr?.slice(-400)})`).toBeNull()
    expect(res.status, res.stderr?.slice(-800)).toBe(0)
    const line = (res.stdout ?? '').split('\n').find((l) => l.startsWith('FUZZ '))
    expect(line, res.stdout).toBeDefined()
    const times = JSON.parse(line!.slice(5)) as Record<string, Record<string, number>>
    const slow: string[] = []
    for (const src of NASTY) {
      const row = times[src]
      expect(row, src).toBeDefined()
      for (const [call, ms] of Object.entries(row)) if (!(ms < 500 * PERF)) slow.push(`${src} ${call} ${ms.toFixed(0)} ms`)
    }
    expect(slow).toEqual([])
    // No domain or range text states an endpoint past 1e5 that its formula
    // did not write: such a number is a sampled pattern printed as a list.
    const textLine = (res.stdout ?? '').split('\n').find((l) => l.startsWith('TEXT '))
    expect(textLine, res.stdout).toBeDefined()
    const texts = JSON.parse(textLine!.slice(5)) as Record<string, { domain: string[]; range: string[] }>
    const artefacts: string[] = []
    for (const src of NASTY) {
      const written = statedNumbers(src)
      for (const t of [...(texts[src]?.domain ?? []), ...(texts[src]?.range ?? [])]) {
        for (const v of statedNumbers(t)) if (v > 1e5 && !written.includes(v)) artefacts.push(`${src}: ${t.slice(0, 80)}`)
      }
    }
    expect(artefacts).toEqual([])
  }, 120_000 * PERF)

  it('the one that hung: the horizontal line test fails, with a real witness', () => {
    const t = typed('y = (e^(2x) - 1)/sin(x)')
    const o = oneToOneInfo(t.curve, t.models)
    expect(o?.oneToOne).toBe(false)
    const w = o?.witness
    expect(w).toBeDefined()
    const f = (x: number) => t.spec.evalExplicit!(t.curve.params, x)
    expect(w!.xs.length).toBeGreaterThanOrEqual(2)
    for (const x of w!.xs) expect(f(x)).toBeCloseTo(w!.y, 6)
  })

  it('an analysis that cannot finish leaves the one-to-one row out rather than guess "No"', () => {
    // (e^(2x) − 1)/ln(1 + x) increases on (−1, 0) and on (0, ∞), with values
    // (0, 2) and (2, ∞): one-to-one. Its end at −1 crawls (1/ln) and is not
    // read, so there is no proof either way — and no "No".
    const t = typed('y = (e^(2x) - 1)/ln(1 + x)')
    const o = oneToOneInfo(t.curve, t.models)
    expect(o === null || o.oneToOne === true || o.witness !== undefined).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 2. asymptotes on their own merit
// ---------------------------------------------------------------------------

describe('an asymptote is written on its own merit', () => {
  it('(e^(2x) − 1)/arctan x leans on y = 2/π as x → −∞ — not "y = 0"', () => {
    const t = typed('y = (e^(2x) - 1)/arctan(x)')
    const found = findAsymptotes(t.curve, t.models, [-10, 10])
    expect(found).toHaveLength(1)
    // the card's own scale for this curve is ~2e5: the old row rounded at it
    const scale = curveScale(t.curve, t.spec)
    expect(scale!).toBeGreaterThan(1e4)
    expect(asymptoteTexts(t.curve, t.models, scale)).toEqual(['y = 2/π'])
    expect(asymptoteForm(2 / Math.PI)?.text).toBe('2/π')
    expect(asymptoteForm(-3 / (2 * Math.PI))?.text).toBe('−3/(2π)')
    expect(asymptoteForm(Math.LN2)).toBeNull()
  })

  it('a short decimal that is the value stays a decimal; a small real one keeps its digits', () => {
    const t = typed('y = 0.0001/x + 0.00003')
    expect(asymptoteTexts(t.curve, t.models, 1e6)).toEqual(['x = 0', 'y = 3.00e-5'])
    // a limit read off the ladder is 1.5 only to ~1e−9: its closed form is the answer
    const u = typed('y = (3x+1)/(2x-2)')
    expect(asymptoteTexts(u.curve, u.models, 1e6)).toEqual(['x = 1', 'y = 3/2'])
    // a family's parameter IS the number: 1.5 stays 1.5
    const recip: FittedCurve = {
      id: 'r', modelId: 'recip', params: [2, 3, 1.5], kind: 'explicit', domain: null,
      color: '#4f9cf9', strokeWidth: 2.5, visible: true, error: 0,
    }
    expect(asymptoteTexts(recip, MODELS, 1e6)).toEqual(['x = 3', 'y = 1.5'])
  })

  it('the answer key and the description say the same', () => {
    const def: ExampleDef = {
      id: 'test-asym', course: 'calc', unit: 'U1', help: ['calc-1'], title: 't', short: 's', note: 'n', keywords: [],
      build: (b) => {
        b.frame([-4, 3], [-2, 6])
        b.line('q(x) = (e^(2x) - 1)/arctan(x)')
      },
    }
    const model = docModelFromJSON(buildExample(def).json)!
    const asym = docAnswerLines(model).filter((l) => l.label.endsWith('asymptote')).map((l) => l.value)
    expect(asym).toEqual(['y = 2/π'])
    expect(describeBoard(model, { answers: true }).long).toContain('y = 2/π')
  })
})

// ---------------------------------------------------------------------------
// 3. removable 0/0 of higher order
// ---------------------------------------------------------------------------

describe('a removable 0/0 is a hole at any order', () => {
  const cases: [string, number, string][] = [
    ['y = (e^x - 1 - x)/x^2', 0.5, '1/2'],
    ['y = (1 - cos(x))/x^2', 0.5, '1/2'],
    ['y = (sin(x) - x)/x^3', -1 / 6, '−1/6'],
    ['y = (e^(2x) - 1)/ln(1 + x)', 2, '2'],
    ['y = sin(x)/x', 1, '1'],
  ]
  for (const [src, y, text] of cases) {
    it(`${src}: a hole at (0, ${text}), no vertical asymptote`, () => {
      const t = typed(src)
      expect(findPoles(t.curve, t.models, [-10, 10])).toEqual([])
      expect(findAsymptotes(t.curve, t.models, [-10, 10]).some((a) => a.kind === 'vertical')).toBe(false)
      const holes = findHoles(t.curve, t.models, [-10, 10])
      expect(holes).toHaveLength(1)
      expect(holes[0].x).toBe(0)
      expect(holes[0].y).toBeCloseTo(y, 12)
      const hole = analyzeCurve(t.curve, t.models).find((p) => p.kind === 'hole')
      expect(hole?.exactY).toBe(text)
    })
  }

  it('a genuine pole is still a pole, and a jump is neither', () => {
    for (const src of ['y = 1/x', 'y = (e^x)/x^2', 'y = (e^x - 1)/x^2', 'y = 1/sin(x)']) {
      const t = typed(src)
      expect(findPoles(t.curve, t.models, [-1, 1]), src).toEqual([0])
      expect(findHoles(t.curve, t.models, [-1, 1]), src).toEqual([])
    }
    const j = typed('y = abs(x)/x')
    expect(findPoles(j.curve, j.models, [-1, 1])).toEqual([])
    expect(findHoles(j.curve, j.models, [-1, 1])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 4. key points in the domain, and real values kept
// ---------------------------------------------------------------------------

describe('key points lie in the domain', () => {
  it('(e^(2x) − 1)/ln(1 + x) has no zero at −1: ln(1 + x) does not exist there', () => {
    const pts = points('y = (e^(2x) - 1)/ln(1 + x)')
    expect(pts.some((p) => p.kind === 'zero')).toBe(false)
    for (const p of pts) expect(p.pos.x).toBeGreaterThan(-1)
    const infl = pts.find((p) => p.kind === 'inflection')
    expect(infl?.pos.x).toBeCloseTo(-0.785334, 5)
    expect(infl?.pos.y).toBeCloseTo(0.514791, 5)
  })

  it('a zero ON a closed boundary stays: √x at 0, √(4 − x²) at ±2', () => {
    expect(points('y = sqrt(x)').filter((p) => p.kind === 'zero').map((p) => p.pos.x)).toEqual([0])
    expect(points('y = sqrt(4 - x^2)').filter((p) => p.kind === 'zero').map((p) => p.pos.x)).toEqual([-2, 2])
  })

  it('the card, the board and the key print that inflection as (−0.7853, 0.5148), not (−0.7853, 0)', () => {
    const t = typed('y = (e^(2x) - 1)/ln(1 + x)')
    const infl = analyzeCurve(t.curve, t.models).find((p) => p.kind === 'inflection')!
    const scale = curveScale(t.curve, t.spec)
    // the curve reaches ~10⁵ on the card's window: its scale alone floors 0.5148
    expect(pointText(infl, { decimal: false, scale })).toBe('(−0.7853, 0)')
    const local = pointScale(t.curve, t.spec, infl.pos.x, scale)
    expect(pointText(infl, { decimal: false, scale: local })).toBe('(−0.7853, 0.5148)')

    // the gallery path, with N and D typed beside it
    const def: ExampleDef = {
      id: 'test-ln-quotient', course: 'calc', unit: 'U4', help: ['calc-4'], title: 't', short: 's', note: 'n', keywords: [],
      build: (b) => {
        b.frame([-2, 3], [-2, 6])
        b.line('N(x) = e^(2x) - 1', { dash: [6, 5] })
        b.line('D(x) = ln(1 + x)', { dash: [6, 5] })
        b.line('q(x) = (e^(2x) - 1)/ln(1 + x)')
      },
    }
    const model = docModelFromJSON(buildExample(def).json)!
    const lines = docAnswerLines(model).map((l) => `${l.label}: ${l.value}`)
    expect(lines).toContain('q · inflection point: (−0.7853, 0.5148)')
    expect(lines.some((l) => l.startsWith('q · zero'))).toBe(false)
    const q = model.board.curves.find((c) => model.board.exprSources[c.id]?.startsWith('q(x)'))!
    const at = boardLabelScale(model.vp, q, model.models)
    expect(boardPointText(infl, at)).toBe('(−0.7853, 0.5148)')
  })

  it('a wave keeps its scale: a 5e−4 midline offset still reads 0', () => {
    const t = typed('y = 3.25sin(x) + 0.000509')
    const scale = curveScale(t.curve, t.spec)
    expect(pointScale(t.curve, t.spec, 0, scale)).toBe(scale)
  })
})

// ---------------------------------------------------------------------------
// 5. the key rounds like the board
// ---------------------------------------------------------------------------

describe('the answer key rounds a point as the board does', () => {
  it('the cycloid example lists (0, 0), never e-notation', () => {
    const built = buildExample(exampleById('calc-u9-cycloid')!)
    const values = docAnswerLines(docModelFromJSON(built.json)!).map((l) => l.value)
    for (const v of values) expect(v, v).not.toMatch(/\de[-+−]?\d/)
    expect(values).toContain('(0, 0)')
    expect(values).toContain('(6.283, 0)')
  })
})

// ---------------------------------------------------------------------------
// 6. parametric and polar points inside their own interval
// ---------------------------------------------------------------------------

describe('parametric extremes stay in the t-interval', () => {
  it('(t² − 4t, t − 1) on 0 ≤ t ≤ 5 is rightmost and highest at its end (5, 4)', () => {
    const pts = points('(x, y) = (t^2 - 4t, t - 1) {0 <= t <= 5}')
    const right = pts.find((p) => p.label === 'right')!
    const top = pts.find((p) => p.label === 'top')!
    expect(right.pos).toEqual({ x: 5, y: 4 })
    expect(top.pos).toEqual({ x: 5, y: 4 })
    const left = pts.find((p) => p.label === 'left')!
    expect(left.pos.x).toBeCloseTo(-4, 9)
    const bottom = pts.find((p) => p.label === 'bottom')!
    expect(bottom.pos).toEqual({ x: 0, y: -1 })
  })

  it('the shipped cusp example labels (2.25, ±3.375), not (2.2625, ±3.4032)', () => {
    const built = buildExample(exampleById('calc-u9-parametric-cusp')!)
    const model = docModelFromJSON(built.json)!
    const c = model.board.curves.find((k) => k.kind === 'parametric')!
    const pts = analyzeCurve(c, model.models)
    for (const p of pts) {
      expect(Math.abs(p.pos.x)).toBeLessThanOrEqual(2.25 + 1e-12)
      expect(Math.abs(p.pos.y)).toBeLessThanOrEqual(3.375 + 1e-12)
    }
    expect(pts.find((p) => p.label === 'top')?.pos).toEqual({ x: 2.25, y: 3.375 })
    expect(pts.find((p) => p.label === 'bottom')?.pos).toEqual({ x: 2.25, y: -3.375 })
    const values = docAnswerLines(model).map((l) => l.value)
    expect(values).toContain('(2.250, 3.375)')
    expect(values).toContain('(2.250, −3.375)')
  })

  it('a rose drawn on part of a turn lists only the tips it sweeps', () => {
    const rose = (domain: [number, number] | null): FittedCurve => ({
      id: 'r', modelId: 'polarRose', params: [2, 3, 0], kind: 'polar', domain,
      color: '#4f9cf9', strokeWidth: 2.5, visible: true, error: 0,
    })
    const tips = (d: [number, number] | null) => analyzeCurve(rose(d), MODELS).filter((p) => p.kind === 'petal-tip')
    expect(tips(null)).toHaveLength(3)
    expect(tips([0, Math.PI])).toHaveLength(3)
    // 0 ≤ θ ≤ π/6 reaches one tip, (2, 0), and stops at the origin
    const part = tips([0, Math.PI / 6])
    expect(part).toHaveLength(1)
    expect(part[0].pos.x).toBeCloseTo(2, 12)
    expect(part[0].pos.y).toBeCloseTo(0, 12)
  })
})

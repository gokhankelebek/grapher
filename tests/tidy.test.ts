// ============================================================================
// tests/tidy.test.ts — "Tidy to nice numbers" for a sketched curve.
//
// Sketches are drawn the way tests/recognize.test.ts draws them: ground truth
// + seeded hand jitter + pixel quantization through the real stroke pipeline,
// then fitted by the app's own recognize(). The FittedCurve handed to
// tidyOffer() is exactly what the canvas would build from that result.
//
// Every offer is checked two ways: `src` must parse and plot the same
// function as MODELS[modelId] at offer.params (to 1e-9), and `text`, read
// back into parser syntax, must plot that same function too.
// ============================================================================

import { describe, it, expect } from 'vitest'
import type { FittedCurve, FitResult, Vec2 } from '../src/core/types'
import { tidyOffer, type TidyOffer } from '../src/core/tidy'
import { recognize } from '../src/core/fit/recognize'
import { MODELS } from '../src/core/fit/models'
import { polyfit } from '../src/core/fit/optimize'
import { parseExpression } from '../src/core/parse/index'
import { VP, makeRng, makeGauss, drawStroke, explicitPath, ranking } from './helpers'

// ---------------------------------------------------------------------------
// Building sketches
// ---------------------------------------------------------------------------

function toCurve(fit: FitResult, ink: Vec2[]): FittedCurve {
  return {
    id: 'c1',
    modelId: fit.modelId,
    params: fit.params.slice(),
    kind: fit.kind,
    domain: fit.domain,
    color: '#fff',
    strokeWidth: 2.5,
    visible: true,
    sourceStroke: ink,
    error: fit.error,
  }
}

/**
 * Draw `fn` over [s0, s1] with seeded jitter, recognize it, and return the
 * curve the `family` candidate would become (the Read-as row the teacher
 * could pick, whether or not it won).
 */
function sketch(
  fn: (s: number) => Vec2, s0: number, s1: number, family: string, seed: number,
): FittedCurve {
  const stroke = drawStroke(fn, s0, s1, makeRng(seed * 7919 + 13))
  const results = recognize(stroke, VP)
  const fit = results.find(r => r.modelId === family)
  if (!fit) throw new Error(`no ${family} candidate; ranking: ${ranking(results)}`)
  return toCurve(fit, stroke.points)
}

const E = (f: (x: number) => number) => explicitPath(f)
const ring = (cx: number, cy: number, r: number) => (t: number): Vec2 => ({
  x: cx + r * Math.cos(t),
  y: cy + r * Math.sin(t),
})

// ---------------------------------------------------------------------------
// The correctness check every offer must pass
// ---------------------------------------------------------------------------

/** Read the Unicode label back into parser syntax (a test-only inverse). */
function textToSrc(text: string): string {
  const SUP: Record<string, string> = {
    '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6',
    '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', 'ˣ': 'x',
  }
  const VULGAR: Record<string, string> = {
    '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4', '⅕': '1/5',
    '⅖': '2/5', '⅗': '3/5', '⅘': '4/5', '⅙': '1/6', '⅚': '5/6', '⅐': '1/7',
    '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8', '⅑': '1/9', '⅒': '1/10',
  }
  let s = text
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻ˣ]+/g, run => `^(${[...run].map(c => SUP[c]).join('')})`)
  s = s.replace(/[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅐⅛⅜⅝⅞⅑⅒]/g, g => `(${VULGAR[g]})`)
  s = s.replace(/√x/g, 'sqrt(x)').replace(/√\(/g, 'sqrt(')
  s = s.replace(/∛x/g, 'cbrt(x)').replace(/∛\(/g, 'cbrt(')
  s = s.replace(/π/g, ' pi ').replace(/·/g, '*').replace(/−/g, '-')
  return s
}

/** Does `src` plot exactly MODELS[modelId] at params? (relative 1e-9) */
function agrees(src: string, modelId: string, params: number[], probe: Vec2[]): void {
  const parsed = parseExpression(src)
  expect(parsed.ok, `"${src}" must parse: ${parsed.ok ? '' : parsed.error}`).toBe(true)
  if (!parsed.ok) return
  const spec = MODELS[modelId]
  const typed = parsed.plot.makeModel('expr_tidy')
  const p0 = parsed.plot.defaultParams
  expect(parsed.plot.paramNames, `"${src}" must have no free constants`).toEqual([])
  let compared = 0
  for (const pt of probe) {
    if (spec.kind === 'implicit') {
      expect(parsed.plot.kind).toBe('implicit')
      const want = spec.evalImplicit!(params, pt.x, pt.y)
      const got = typed.evalImplicit!(p0, pt.x, pt.y)
      expect(Math.abs(got - want), `${src} at (${pt.x}, ${pt.y})`)
        .toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(want)))
      compared++
    } else {
      expect(parsed.plot.kind).toBe('explicit')
      const want = spec.evalExplicit!(params, pt.x)
      const got = typed.evalExplicit!(p0, pt.x)
      if (!Number.isFinite(want)) continue // both sides of a branch point / pole
      expect(Math.abs(got - want), `${src} at x = ${pt.x}`)
        .toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(want)))
      compared++
    }
  }
  expect(compared).toBeGreaterThan(20)
}

/** The probe set: a grid over the ink's neighbourhood, plus every ink point. */
function probeFor(curve: FittedCurve): Vec2[] {
  const ink = curve.sourceStroke ?? []
  const xs = ink.map(p => p.x), ys = ink.map(p => p.y)
  const x0 = Math.min(...xs) - 1, x1 = Math.max(...xs) + 1
  const y0 = Math.min(...ys) - 1, y1 = Math.max(...ys) + 1
  const out: Vec2[] = []
  for (let i = 0; i <= 40; i++) {
    for (let j = 0; j <= 4; j++) {
      out.push({ x: x0 + ((x1 - x0) * i) / 40 + 1e-3, y: y0 + ((y1 - y0) * j) / 4 })
    }
  }
  return out.concat(ink)
}

/** Everything an offer promises, checked. */
function checkOffer(curve: FittedCurve, offer: TidyOffer): void {
  expect(offer.modelId).toBe(curve.modelId)
  expect(offer.params).toHaveLength(curve.params.length)
  expect(offer.params.every(Number.isFinite)).toBe(true)
  expect(Number.isFinite(offer.rms) && offer.rms >= 0).toBe(true)
  // the label is pretty: a real minus sign, no ASCII operators
  expect(offer.text).not.toMatch(/ - |\*|\^\d|sqrt|cbrt|pi/)
  expect(offer.src).not.toMatch(/−|π|[²³ˣ]/)
  const probe = probeFor(curve)
  agrees(offer.src, offer.modelId, offer.params, probe)
  agrees(textToSrc(offer.text), offer.modelId, offer.params, probe)
  // and it IS tidy: applying it leaves nothing more to offer
  expect(tidyOffer({ ...curve, params: offer.params, error: offer.rms })).toBeNull()
}

/** Sketch, tidy, check, and return the offer (asserting there is one). */
function tidyOf(
  fn: (s: number) => Vec2, s0: number, s1: number, family: string, seed: number,
): { curve: FittedCurve; offer: TidyOffer } {
  const curve = sketch(fn, s0, s1, family, seed)
  const offer = tidyOffer(curve)
  expect(offer, `${family} seed ${seed}: params ${curve.params.join(', ')}`).not.toBeNull()
  checkOffer(curve, offer!)
  return { curve, offer: offer! }
}

const SEEDS = [1, 2, 3]

function expectTidy(
  name: string, fn: (s: number) => Vec2, s0: number, s1: number, family: string,
  src: string, text: string,
): void {
  it(`${name} → ${text}`, () => {
    for (const seed of SEEDS) {
      const { offer } = tidyOf(fn, s0, s1, family, seed)
      expect(offer.src, `seed ${seed}`).toBe(src)
      expect(offer.text, `seed ${seed}`).toBe(text)
    }
  })
}

function expectNone(name: string, fn: (s: number) => Vec2, s0: number, s1: number, family: string): void {
  it(`${name}: nothing offered`, () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const curve = sketch(fn, s0, s1, family, seed)
      const offer = tidyOffer(curve)
      expect(offer?.src ?? null, `seed ${seed}: params ${curve.params.join(', ')}`).toBeNull()
    }
  })
}

// ---------------------------------------------------------------------------
// The motivating case
// ---------------------------------------------------------------------------

describe('tidyOffer — the parabola that started it', () => {
  it('0.99251x² + 0.03295x − 3.9329 (σ ≈ 0.025) is offered y = x² − 4', () => {
    for (let seed = 1; seed <= 8; seed++) {
      // ink that the fitter reads as the slightly-off parabola: the hand's
      // systematic miss plus jitter, sampled unevenly like a real stroke
      const g = makeGauss(makeRng(seed))
      const ink: Vec2[] = []
      for (let i = 0; i < 150; i++) {
        const x = -3 + (6 * i) / 149 + 0.01 * g()
        ink.push({ x, y: 0.99251 * x * x + 0.03295 * x - 3.9329 + 0.025 * g() })
      }
      const c = polyfit(ink.map(p => p.x), ink.map(p => p.y), 2)!
      let ss = 0
      for (const p of ink) ss += (p.y - (c[0] + c[1] * p.x + c[2] * p.x * p.x)) ** 2
      const curve: FittedCurve = {
        id: 'c1', modelId: 'poly2', params: c, kind: 'explicit', domain: [-3.3, 3.3],
        color: '#fff', strokeWidth: 2.5, visible: true, sourceStroke: ink,
        error: Math.sqrt(ss / ink.length),
      }
      expect(c[2]).toBeCloseTo(0.9925, 2)
      expect(curve.error).toBeGreaterThan(0.02)
      expect(curve.error).toBeLessThan(0.03)
      const offer = tidyOffer(curve)
      expect(offer, `seed ${seed}`).not.toBeNull()
      expect(offer!.src).toBe('y = x^2 - 4')
      expect(offer!.text).toBe('y = x² − 4')
      expect(offer!.params).toEqual([-4, 0, 1])
      // the tidy misses the ink by more than the fit did, but not by much
      expect(offer!.rms).toBeGreaterThan(curve.error)
      expect(offer!.rms).toBeLessThan(0.1)
      checkOffer(curve, offer!)
    }
  })
})

// ---------------------------------------------------------------------------
// Families
// ---------------------------------------------------------------------------

describe('tidyOffer — polynomials', () => {
  expectTidy('x² − 4', E(x => x * x - 4), -3, 3, 'poly2', 'y = x^2 - 4', 'y = x² − 4')
  expectTidy('2(x − 1)² − 3 (vertex form)', E(x => 2 * (x - 1) ** 2 - 3), -1, 3, 'poly2',
    'y = 2(x - 1)^2 - 3', 'y = 2(x − 1)² − 3')
  expectTidy('−x²/2 + 3 (downward)', E(x => -0.5 * x * x + 3), -3, 3, 'poly2',
    'y = -(1/2)x^2 + 3', 'y = −½x² + 3')
  expectTidy('2x + 1', E(x => 2 * x + 1), -3, 3, 'line', 'y = 2x + 1', 'y = 2x + 1')
  expectTidy('x/2 − 3', E(x => x / 2 - 3), -5, 5, 'line', 'y = (1/2)x - 3', 'y = ½x − 3')
  expectTidy('−x', E(x => -x), -4, 4, 'line', 'y = -x', 'y = −x')
  expectTidy('x³ − 3x', E(x => x ** 3 - 3 * x), -2.2, 2.2, 'poly3', 'y = x^3 - 3x', 'y = x³ − 3x')
  expectTidy('x⁴/4 − 2x²', E(x => x ** 4 / 4 - 2 * x * x), -3, 3, 'poly4',
    'y = (1/4)x^4 - 2x^2', 'y = ¼x⁴ − 2x²')

  it('the parabola params land in the poly2 layout, ascending', () => {
    const { offer } = tidyOf(E(x => 2 * (x - 1) ** 2 - 3), -1, 3, 'poly2', 1)
    expect(offer.params).toEqual([-1, -4, 2]) // 2x² − 4x − 1
  })
})

describe('tidyOffer — sinusoids', () => {
  expectTidy('2sin(x) + 1', E(x => 2 * Math.sin(x) + 1), -6, 6, 'sine',
    'y = 2sin(x) + 1', 'y = 2sin(x) + 1')
  expectTidy('3sin(2x)', E(x => 3 * Math.sin(2 * x)), -3, 3, 'sine', 'y = 3sin(2x)', 'y = 3sin(2x)')
  expectTidy('amplitude 1.5', E(x => 1.5 * Math.sin(x)), -6, 6, 'sine',
    'y = (3/2)sin(x)', 'y = (3/2)sin(x)')
  expectTidy('2sin(x − π/4)', E(x => 2 * Math.sin(x - Math.PI / 4)), -6, 6, 'sine',
    'y = 2sin(x - pi/4)', 'y = 2sin(x − π/4)')
  expectTidy('sin((π/2)(x − ½)) — period 4', E(x => Math.sin((Math.PI / 2) * (x - 0.5))), -4, 6, 'sine',
    'y = sin((pi/2)(x - 1/2))', 'y = sin((π/2)(x − ½))')
  // sin(π/2·(x − 1)) IS −cos(πx/2), and that is the simpler thing to write
  expectTidy('sin(π/2·(x − 1))', E(x => Math.sin((Math.PI / 2) * (x - 1))), -4, 6, 'sine',
    'y = -cos(pi x/2)', 'y = −cos(πx/2)')
  expectTidy('cos(x)', E(x => Math.cos(x)), -6, 6, 'sine', 'y = cos(x)', 'y = cos(x)')
})

describe('tidyOffer — exponentials', () => {
  expectTidy('eˣ', E(x => Math.exp(x)), -3, 1.8, 'exp', 'y = e^x', 'y = eˣ')
  expectTidy('2ˣ', E(x => 2 ** x), -3, 2.5, 'exp', 'y = 2^x', 'y = 2ˣ')
  expectTidy('3·2ˣ − 1', E(x => 3 * 2 ** x - 1), -3, 1, 'exp', 'y = 3(2)^x - 1', 'y = 3·2ˣ − 1')
  expectTidy('e⁻ˣ + 2', E(x => Math.exp(-x) + 2), -1.5, 4, 'exp', 'y = e^(-x) + 2', 'y = e⁻ˣ + 2')
  expectTidy('(½)ˣ', E(x => 0.5 ** x), -2.5, 3, 'exp', 'y = (1/2)^x', 'y = (½)ˣ')
})

describe('tidyOffer — circles', () => {
  expectTidy('x² + y² = 9', ring(0, 0, 3), 0, 2 * Math.PI, 'circle', 'x^2 + y^2 = 9', 'x² + y² = 9')
  expectTidy('(x − 1)² + (y + 2)² = 4', ring(1, -2, 2), 0, 2 * Math.PI, 'circle',
    '(x - 1)^2 + (y + 2)^2 = 4', '(x − 1)² + (y + 2)² = 4')
  expectTidy('r² = 5', ring(0, 0, Math.sqrt(5)), 0, 2 * Math.PI, 'circle', 'x^2 + y^2 = 5', 'x² + y² = 5')

  it('r² = 5 keeps r = √5 exactly in the params', () => {
    const { offer } = tidyOf(ring(0, 0, Math.sqrt(5)), 0, 2 * Math.PI, 'circle', 1)
    expect(offer.params).toEqual([0, 0, Math.sqrt(5)])
  })
})

describe('tidyOffer — abs, sqrt, cbrt, log, recip', () => {
  expectTidy('2|x − 1| + 3', E(x => 2 * Math.abs(x - 1) + 3), -2, 3.5, 'abs',
    'y = 2|x - 1| + 3', 'y = 2|x − 1| + 3')
  expectTidy('√(x + 2) − 1', E(x => Math.sqrt(x + 2) - 1), -2, 6, 'sqrt',
    'y = sqrt(x + 2) - 1', 'y = √(x + 2) − 1')
  expectTidy('∛x', E(x => Math.cbrt(x)), -5, 5, 'cbrt', 'y = cbrt(x)', 'y = ∛x')
  expectTidy('2∛(x − 1)', E(x => 2 * Math.cbrt(x - 1)), -4, 6, 'cbrt',
    'y = 2cbrt(x - 1)', 'y = 2∛(x − 1)')
  expectTidy('ln(x − 1)', E(x => Math.log(x - 1)), 1.05, 8, 'log', 'y = ln(x - 1)', 'y = ln(x − 1)')
  expectTidy('2/(x − 1) + 3', E(x => 2 / (x - 1) + 3), 1.6, 6, 'recip',
    'y = 2/(x - 1) + 3', 'y = 2/(x − 1) + 3')

  it('a sqrt or log offer moves the domain start to the new branch point', () => {
    for (const [fn, s0, s1, fam] of [
      [E(x => Math.sqrt(x + 2) - 1), -2, 6, 'sqrt'],
      [E(x => Math.log(x - 1)), 1.05, 8, 'log'],
    ] as const) {
      const { curve, offer } = tidyOf(fn, s0, s1, fam, 2)
      expect(offer.domain).not.toBeNull()
      expect(offer.domain![0]).toBe(offer.params[1])
      expect(offer.domain![1]).toBe(curve.domain![1])
    }
  })

  it('other families keep their domain', () => {
    const { curve, offer } = tidyOf(E(x => 2 * Math.abs(x - 1) + 3), -2, 3.5, 'abs', 1)
    expect(offer.domain).toEqual(curve.domain)
  })
})

// ---------------------------------------------------------------------------
// Less common shapes: ink built directly from a known curve, fitted params a
// fraction of a percent off (what the fitter hands back), σ measured honestly
// ---------------------------------------------------------------------------

function constructed(modelId: string, truth: number[], x0: number, x1: number): FittedCurve {
  const g = makeGauss(makeRng(7))
  const spec = MODELS[modelId]
  const ink: Vec2[] = []
  for (let i = 0; i < 160; i++) {
    if (modelId === 'circle') {
      const t = (2 * Math.PI * i) / 159
      ink.push({
        x: truth[0] + truth[2] * Math.cos(t) + 0.02 * g(),
        y: truth[1] + truth[2] * Math.sin(t) + 0.02 * g(),
      })
      continue
    }
    const x = x0 + ((x1 - x0) * i) / 159
    const y = spec.evalExplicit!(truth, x)
    if (Number.isFinite(y)) ink.push({ x: x + 0.01 * g(), y: y + 0.02 * g() })
  }
  const params = truth.map((v, i) => v + 0.003 * (i % 2 ? 1 : -1) * Math.max(0.2, Math.abs(v)))
  let ss = 0
  for (const p of ink) {
    const r = modelId === 'circle'
      ? Math.hypot(p.x - params[0], p.y - params[1]) - params[2]
      : p.y - spec.evalExplicit!(params, p.x)
    ss += Number.isFinite(r) ? r * r : 0
  }
  return {
    id: 'c1', modelId, params, kind: spec.kind, domain: null, color: '#fff',
    strokeWidth: 2.5, visible: true, sourceStroke: ink, error: Math.sqrt(ss / ink.length),
  }
}

describe('tidyOffer — every family prints cleanly', () => {
  const L2 = Math.log(2), L3 = Math.log(3)
  const cases: Array<[string, number[], number, number, string, string]> = [
    ['exp', [1, 0.5, 0], -3, 3, 'y = e^(x/2)', 'y = e^(x/2)'],
    ['exp', [2, -0.5, 1], -3, 3, 'y = 2e^(-x/2) + 1', 'y = 2e^(−x/2) + 1'],
    ['exp', [0.5, L3, 0], -2, 2, 'y = (1/2)(3)^x', 'y = ½·3ˣ'],
    ['exp', [-1, L2, 4], -2, 2.5, 'y = -2^x + 4', 'y = −2ˣ + 4'],
    ['exp', [3, -L2, 0], -2, 3, 'y = 3(1/2)^x', 'y = 3(½)ˣ'],
    ['sine', [1, 0.5, 0, 0], -12, 12, 'y = sin(x/2)', 'y = sin(x/2)'],
    ['sine', [1, Math.PI, 0, 0], -2, 2, 'y = sin(pi x)', 'y = sin(πx)'],
    ['sine', [2, 2, -Math.PI / 2, 0], -3, 3, 'y = -2cos(2x)', 'y = −2cos(2x)'],
    ['sine', [1, (2 * Math.PI) / 3, 0, 1], -3, 3, 'y = sin(2pi x/3) + 1', 'y = sin(2πx/3) + 1'],
    ['sine', [3, 2, -Math.PI / 3, 0], -3, 3, 'y = 3sin(2(x - pi/6))', 'y = 3sin(2(x − π/6))'],
    ['recip', [0.5, 1, 0], 1.3, 5, 'y = 1/(2(x - 1))', 'y = 1/(2(x − 1))'],
    ['recip', [-1, 0, 2], 0.3, 5, 'y = -1/x + 2', 'y = −1/x + 2'],
    ['abs', [0.5, -1, 0], -4, 3, 'y = (1/2)|x + 1|', 'y = ½|x + 1|'],
    ['abs', [-1, 0, 2], -3, 3, 'y = -|x| + 2', 'y = −|x| + 2'],
    ['sqrt', [0.5, 0, 0], 0, 8, 'y = (1/2)sqrt(x)', 'y = ½√x'],
    ['sqrt', [-2, 1, 3], 1, 5, 'y = -2sqrt(x - 1) + 3', 'y = −2√(x − 1) + 3'],
    ['log', [2, -0.5, 1], -0.45, 5, 'y = 2ln(x + 1/2) + 1', 'y = 2ln(x + ½) + 1'],
    ['cbrt', [-1, 2, 1], -4, 8, 'y = -cbrt(x - 2) + 1', 'y = −∛(x − 2) + 1'],
    ['poly2', [0, 0, 0.1], -6, 6, 'y = (1/10)x^2', 'y = ⅒x²'],
    ['poly2', [1, 2, 1], -4, 2, 'y = (x + 1)^2', 'y = (x + 1)²'],
    ['poly2', [0, -2, 1], -2, 4, 'y = x^2 - 2x', 'y = x² − 2x'],
    ['line', [1.5, -0.75], -4, 4, 'y = -(3/4)x + 3/2', 'y = −¾x + 3/2'],
    ['line', [0, 1 / 3], -6, 6, 'y = (1/3)x', 'y = ⅓x'],
    ['poly3', [-1, 3, -3, 1], -1, 3, 'y = x^3 - 3x^2 + 3x - 1', 'y = x³ − 3x² + 3x − 1'],
    ['circle', [0.5, 0, 1.5], 0, 0, '(x - 1/2)^2 + y^2 = 9/4', '(x − ½)² + y² = 9/4'],
    ['circle', [-1, 2.5, 2], 0, 0, '(x + 1)^2 + (y - 5/2)^2 = 4', '(x + 1)² + (y − 5/2)² = 4'],
  ]
  for (const [modelId, truth, x0, x1, src, text] of cases) {
    it(`${modelId} → ${text}`, () => {
      const curve = constructed(modelId, truth, x0, x1)
      const offer = tidyOffer(curve)
      expect(offer, `params ${curve.params.join(', ')}`).not.toBeNull()
      expect(offer!.src).toBe(src)
      expect(offer!.text).toBe(text)
      checkOffer(curve, offer!)
    })
  }
})

// ---------------------------------------------------------------------------
// What is NOT tidied
// ---------------------------------------------------------------------------

describe('tidyOffer — genuine non-nice coefficients are left alone', () => {
  expectNone('slope 0.62 (not ½, not ⅔)', E(x => 0.62 * x + 0.3), -5, 5, 'line')
  expectNone('slope 0.58', E(x => 0.58 * x - 1), -5, 5, 'line')
  expectNone('1.15x² − 2', E(x => 1.15 * x * x - 2), -2.5, 2.5, 'poly2')
  expectNone('1.3sin(1.3x) + 0.4', E(x => 1.3 * Math.sin(1.3 * x) + 0.4), -5, 5, 'sine')
  expectNone('1.7ˣ', E(x => 1.7 ** x), -3, 3, 'exp')
  expectNone('circle centre (0.3, 0.2), r = 1.8', ring(0.3, 0.2, 1.8), 0, 2 * Math.PI, 'circle')

  it('a genuine 1.3x² is never tidied to x²', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const curve = sketch(E(x => 1.3 * x * x - 2), -2.5, 2.5, 'poly2', seed)
      const offer = tidyOffer(curve)
      // 4/3 is 2.5% away and the ink cannot tell it from 1.3; 1 is 23% away
      if (offer) {
        expect(offer.params[2]).not.toBe(1)
        expect(offer.params[2]).toBeCloseTo(4 / 3, 12)
        checkOffer(curve, offer)
      }
    }
  })
})

describe('tidyOffer — nothing to do, and nothing to throw', () => {
  const ink: Vec2[] = []
  for (let i = 0; i <= 60; i++) {
    const x = -3 + i / 10
    ink.push({ x, y: x * x - 4 + 0.02 * Math.sin(7 * x) })
  }
  const base: FittedCurve = {
    id: 'c1', modelId: 'poly2', params: [-4, 0, 1], kind: 'explicit', domain: [-3.3, 3.3],
    color: '#fff', strokeWidth: 2.5, visible: true, sourceStroke: ink, error: 0.014,
  }

  it('an already-tidy curve gets no offer', () => {
    expect(tidyOffer(base)).toBeNull()
    // (the untidy version of the same sketch is offered it, so the null is earned)
    expect(tidyOffer({ ...base, params: [-3.93, 0.033, 0.9925], error: 0.1 })?.src).toBe('y = x^2 - 4')
  })

  it('a typed expr_ curve gets no offer, even carrying ink', () => {
    expect(tidyOffer({ ...base, modelId: 'expr_3', params: [] })).toBeNull()
    expect(tidyOffer({ ...base, modelId: 'expr_12', params: [0.99, 0.03, -3.9] })).toBeNull()
  })

  it('unsupported families get no offer', () => {
    const cases: Array<[string, number[]]> = [
      ['gauss', [3, 0.5, 1.2, -1]],
      ['logistic', [4, 1.1, 0.2, 0.9]],
      ['power', [1.02, 0.01, -0.03, 1.98]],
      ['ellipse', [1, 0, 2, 0, 0, -4]],
      ['vline', [1.01]],
      ['polarRose', [2, 3, 0.01]],
      ['limacon', [1, 0.99]],
      ['spiral', [0, 0.51]],
      ['fourier', [0, 0, 1, 0, 0, 1]],
      ['nonsense', [1, 2, 3]],
    ]
    for (const [modelId, params] of cases) {
      expect(tidyOffer({ ...base, modelId, params }), modelId).toBeNull()
    }
  })

  it('garbage in: null, never a throw', () => {
    const bad: unknown[] = [
      { ...base, params: [Number.NaN, 0, 1] },
      { ...base, params: [-4, Infinity, 1] },
      { ...base, params: [-4, 0] },
      { ...base, params: [-4, 0, 1, 2] },
      { ...base, params: undefined },
      { ...base, sourceStroke: undefined },
      { ...base, sourceStroke: [] },
      { ...base, sourceStroke: ink.slice(0, 5) },
      { ...base, sourceStroke: ink.map(() => ({ x: Number.NaN, y: 1 })) },
      { ...base, sourceStroke: ink.map(() => ({ x: 1, y: 1 })) },
      { ...base, sourceStroke: [null, undefined, ...ink.slice(0, 3)] },
      { ...base, error: Number.NaN, params: [-3.9, 0.03, 0.99] },
      { ...base, modelId: 'circle', params: [0, 0, 0] },
      { ...base, modelId: 'sine', params: [0, 0, 0, 0] },
      { ...base, modelId: 'exp', params: [1e300, 1e300, 0] },
      { ...base, modelId: 'log', params: [1, 1e9, 0] },
      { ...base, modelId: 'recip', params: [0, 1, 0] },
      { ...base, modelId: undefined },
      {},
      null,
      undefined,
    ]
    for (const c of bad) {
      let out: TidyOffer | null | undefined
      expect(() => { out = tidyOffer(c as FittedCurve) }).not.toThrow()
      // a NaN σ is recomputed from the ink, so that one may still be offered
      if (out) checkOffer(c as FittedCurve, out)
    }
    expect(tidyOffer({ ...base, params: [Number.NaN, 0, 1] })).toBeNull()
    expect(tidyOffer({ ...base, sourceStroke: undefined, params: [-3.9, 0.03, 0.99] })).toBeNull()
  })

  it('a curve edited away from its ink is not snapped back to the ink', () => {
    // the teacher slid the parabola up 3 units; the ink stayed where it was
    expect(tidyOffer({ ...base, params: [-1.07, 0.03, 0.99] })).toBeNull()
    // …or the stored σ is long out of date
    expect(tidyOffer({ ...base, params: [-3.93, 0.033, 0.9925], error: 0.001 })).toBeNull()
  })
})

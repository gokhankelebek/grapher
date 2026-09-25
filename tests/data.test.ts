// ============================================================================
// Data tables and regression (src/core/data.ts)
//
// The regression answers must match a TI-84, so every linearised fit is
// checked against a hand-rolled closed-form least-squares line on the
// transformed data (to 1e-9), with the calculator's printed numbers stated
// alongside. Nonlinear fits must recover known parameters from noiseless data
// (1e-6) and land close on seeded noisy data. Every regressionSource output
// must parse with the app's own parser and evaluate to the fitted model.
// ============================================================================

import { describe, expect, it } from 'vitest'
import {
  fitRegression,
  parseDataText,
  regressionSource,
  suggestModels,
  type RegressionKind,
  type RegressionResult,
} from '../src/core/data'
import { parseExpression } from '../src/core/parse'
import { readExponential } from '../src/core/exponential'
import { readLogarithmic } from '../src/core/logarithmic'
import { makeGauss, makeRng } from './helpers'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Closed-form simple least squares z = intercept + slope·t, and Pearson r. */
function ols(t: number[], z: number[]) {
  const n = t.length
  const mt = t.reduce((a, b) => a + b, 0) / n
  const mz = z.reduce((a, b) => a + b, 0) / n
  let stt = 0, stz = 0, szz = 0
  for (let i = 0; i < n; i++) {
    stt += (t[i] - mt) ** 2
    stz += (t[i] - mt) * (z[i] - mz)
    szz += (z[i] - mz) ** 2
  }
  const slope = stz / stt
  return { slope, intercept: mz - slope * mt, r: stz / Math.sqrt(stt * szz) }
}

function r2Of(ys: number[], fitted: number[]): number {
  const m = ys.reduce((a, b) => a + b, 0) / ys.length
  let sse = 0, sst = 0
  ys.forEach((y, i) => { sse += (y - fitted[i]) ** 2; sst += (y - m) ** 2 })
  return 1 - sse / sst
}

/** The fitted model, straight from the coefficients. */
function modelAt(res: RegressionResult, x: number): number {
  const k = res.coef
  switch (res.kind) {
    case 'linear': return k.a * x + k.b
    case 'quadratic': return k.a * x ** 2 + k.b * x + k.c
    case 'cubic': return k.a * x ** 3 + k.b * x ** 2 + k.c * x + k.d
    case 'quartic': return k.a * x ** 4 + k.b * x ** 3 + k.c * x ** 2 + k.d * x + k.e
    case 'exponential': return k.a * k.b ** x
    case 'power': return k.a * x ** k.b
    case 'logarithmic': return k.a + k.b * Math.log(x)
    case 'logistic': return k.c / (1 + k.a * Math.exp(-k.b * x))
    case 'sinusoidal': return k.a * Math.sin(k.b * x + k.c) + k.d
  }
}

/** Parse a source through the app's parser and evaluate it at x. */
function evalSource(src: string, x: number): number {
  const o = parseExpression(src)
  if (!o.ok) throw new Error(`${src}: ${o.error}`)
  expect(o.plot.kind).toBe('explicit')
  expect(o.plot.paramNames).toEqual([])
  const m = o.plot.makeModel('reg')
  return m.evalExplicit!(o.plot.defaultParams, x)
}

/** Source parses, and matches the model at every data point to ~10^−digits. */
function expectSourceMatches(res: RegressionResult, xs: number[], digits = 4): string {
  const src = regressionSource(res, digits)
  const o = parseExpression(src)
  expect(o.ok, `${src}: ${o.ok ? '' : o.error}`).toBe(true)
  let scale = 1
  for (const x of xs) scale = Math.max(scale, Math.abs(modelAt(res, x)))
  for (const x of xs) {
    const got = evalSource(src, x)
    expect(Math.abs(got - modelAt(res, x)), `${src} at x = ${x}`).toBeLessThan(20 * 10 ** -digits * scale)
  }
  return src
}

const range = (a: number, b: number, step: number) => {
  const out: number[] = []
  for (let x = a; x <= b + 1e-9; x += step) out.push(Number(x.toFixed(10)))
  return out
}

// ---------------------------------------------------------------------------
// parseDataText
// ---------------------------------------------------------------------------

describe('parseDataText: spreadsheet paste shapes', () => {
  it('Google Sheets: tabs, CRLF, header row names the columns', () => {
    const p = parseDataText('Year\tPopulation\r\n1990\t5.2\r\n2000\t6.1\r\n2010\t6.9\r\n')
    expect(p.ok).toBe(true)
    expect(p.xs).toEqual([1990, 2000, 2010])
    expect(p.ys).toEqual([5.2, 6.1, 6.9])
    expect(p.xLabel).toBe('Year')
    expect(p.yLabel).toBe('Population')
    expect(p.skipped).toEqual([])
    expect(p.notes).toEqual([])
  })

  it('Excel: tabs with a trailing tab on every row', () => {
    const p = parseDataText('1\t2\t\n2\t4.5\t\n3\t7\t\n')
    expect(p.ok).toBe(true)
    expect(p.xs).toEqual([1, 2, 3])
    expect(p.ys).toEqual([2, 4.5, 7])
    expect(p.xLabel).toBe('x')
    expect(p.yLabel).toBe('y')
    expect(p.notes).toEqual([])
  })

  it('CSV with quotes and a quoted thousands comma', () => {
    const p = parseDataText('"Year","Sales"\n2019,"1,234"\n2020,"1,560.5"\n2021,"2,001"\n')
    expect(p.ok).toBe(true)
    expect(p.xLabel).toBe('Year')
    expect(p.yLabel).toBe('Sales')
    expect(p.xs).toEqual([2019, 2020, 2021])
    expect(p.ys).toEqual([1234, 1560.5, 2001])
  })

  it('European: semicolons with decimal commas', () => {
    const p = parseDataText('1,5;2,25\n2;3,5\n3,25;1.234,5\n')
    expect(p.ok).toBe(true)
    expect(p.xs).toEqual([1.5, 2, 3.25])
    expect(p.ys).toEqual([2.25, 3.5, 1234.5])
    expect(p.notes.some((n) => /decimal/.test(n))).toBe(true)
  })

  it('space separated, with a two-space header', () => {
    const p = parseDataText('Time (s)  Distance (m)\n0 0\n1   4.9\n2 19.6\n')
    expect(p.ok).toBe(true)
    expect(p.xLabel).toBe('Time (s)')
    expect(p.yLabel).toBe('Distance (m)')
    expect(p.xs).toEqual([0, 1, 2])
    expect(p.ys).toEqual([0, 4.9, 19.6])
  })

  it('one column: y, with x = 1, 2, 3, …', () => {
    const p = parseDataText('Score\n71\n84\n90\n')
    expect(p.ok).toBe(true)
    expect(p.yLabel).toBe('Score')
    expect(p.xs).toEqual([1, 2, 3])
    expect(p.ys).toEqual([71, 84, 90])
    expect(p.notes.join(' ')).toMatch(/One column/)
  })

  it('three columns: the first two, with a note naming the ignored one', () => {
    const p = parseDataText('x\ty\tNote\n1\t2\tfirst\n2\t3\t\n3\t5\tlast\n')
    expect(p.ok).toBe(true)
    expect(p.xs).toEqual([1, 2, 3])
    expect(p.ys).toEqual([2, 3, 5])
    expect(p.notes.join(' ')).toMatch(/ignored column C \(Note\)/)
  })

  it('blank lines are ignored; row numbers stay the pasted line numbers', () => {
    const p = parseDataText('x,y\n1,2\n\n2,4\n   \n3,n/a\n4,8\n')
    expect(p.ok).toBe(true)
    expect(p.xs).toEqual([1, 2, 4])
    expect(p.ys).toEqual([2, 4, 8])
    expect(p.skipped).toEqual([{ row: 6, reason: 'y “n/a” is not a number' }])
  })

  it('a text cell mid-column is skipped with its row and reason', () => {
    const p = parseDataText('Year\tPop\n1990\t5.2\nmissing\t6.1\n2010\t\n2020\t7.7\n')
    expect(p.ok).toBe(true)
    expect(p.xs).toEqual([1990, 2020])
    expect(p.skipped).toEqual([
      { row: 3, reason: 'x “missing” is not a number' },
      { row: 4, reason: 'missing y value' },
    ])
  })

  it('fewer than two numeric rows is an error', () => {
    const one = parseDataText('x\ty\n1\t2\n')
    expect(one.ok).toBe(false)
    expect(one.error).toMatch(/at least two rows/)
    expect(parseDataText('').ok).toBe(false)
    expect(parseDataText('   \n\n').error).toMatch(/Paste or type/)
    expect(parseDataText('a\tb\nc\td\n').ok).toBe(false)
  })

  it('accepts U+2212 minus, $ and %, exponent notation, a BOM', () => {
    const p = parseDataText('﻿−2\t$5\n1e2\t12.5%\n')
    expect(p.ok).toBe(true)
    expect(p.xs).toEqual([-2, 100])
    expect(p.ys).toEqual([5, 12.5])
    expect(p.notes.join(' ')).toMatch(/%/)
  })

  it('never throws on junk', () => {
    for (const s of ['"', '\t\t\t', ';;;', ',,,\n,,,', '\u0000', 'x\n', null as unknown as string]) {
      expect(() => parseDataText(s)).not.toThrow()
    }
  })
})

// ---------------------------------------------------------------------------
// fitRegression — calculator answers
// ---------------------------------------------------------------------------

describe('fitRegression: polynomials (LinReg, QuadReg, …)', () => {
  it('linear matches LinReg(ax+b): a = 1.99, b = 0.05, r = 0.99916', () => {
    const xs = [1, 2, 3, 4, 5]
    const ys = [2, 4.1, 5.9, 8.2, 9.9]
    const r = fitRegression('linear', xs, ys)
    expect(r.ok).toBe(true)
    expect(r.coef.a).toBeCloseTo(1.99, 12)
    expect(r.coef.b).toBeCloseTo(0.05, 12)
    const ref = ols(xs, ys)
    expect(r.r!).toBeCloseTo(ref.r, 12)
    expect(r.r!).toBeCloseTo(0.9991551, 6) // TI-84: r = .9991551337
    expect(r.r2).toBeCloseTo(ref.r * ref.r, 12)
    expect(r.residuals.map((v) => Number(v.toFixed(10)))).toEqual([-0.04, 0.07, -0.12, 0.19, -0.1])
    expect(regressionSource(r)).toBe('y = 1.99x + 0.05')
  })

  it('negative slope and the sign of r', () => {
    const r = fitRegression('linear', [0, 1, 2, 3], [3, 2.1, 0.9, 0])
    expect(r.r!).toBeLessThan(0)
    expect(regressionSource(r)).toBe('y = -1.02x + 3.03')
    const unit = fitRegression('linear', [0, 1, 2], [2, 1, 0])
    expect(regressionSource(unit)).toBe('y = -x + 2')
    const up = fitRegression('linear', [0, 1, 2], [0, 1, 2])
    expect(regressionSource(up)).toBe('y = x')
  })

  it('quadratic is exact on points of a parabola', () => {
    const xs = [-2, -1, 0, 1, 2, 3]
    const ys = xs.map((x) => 2 * x * x - 3 * x + 1)
    const r = fitRegression('quadratic', xs, ys)
    expect(r.ok).toBe(true)
    expect(r.coef.a).toBeCloseTo(2, 12)
    expect(r.coef.b).toBeCloseTo(-3, 12)
    expect(r.coef.c).toBeCloseTo(1, 12)
    expect(r.r2).toBeCloseTo(1, 12)
    expect(r.r).toBeUndefined()
    expect(regressionSource(r)).toBe('y = 2x^2 - 3x + 1')
  })

  it('cubic and quartic recover exact polynomials, even on year-sized x', () => {
    const xs = [0, 1, 2, 3, 4, 5, 6]
    const cubic = fitRegression('cubic', xs, xs.map((x) => 0.5 * x ** 3 - x ** 2 + 4))
    expect(cubic.coef.a).toBeCloseTo(0.5, 10)
    expect(cubic.coef.b).toBeCloseTo(-1, 10)
    expect(cubic.coef.c).toBeCloseTo(0, 10)
    expect(cubic.coef.d).toBeCloseTo(4, 10)
    expect(regressionSource(cubic)).toBe('y = 0.5x^3 - x^2 + 4')
    const quart = fitRegression('quartic', xs, xs.map((x) => -(x ** 4) + 2 * x - 7))
    expect(quart.coef.a).toBeCloseTo(-1, 9)
    expect(quart.coef.e).toBeCloseTo(-7, 9)
    expect(regressionSource(quart)).toBe('y = -x^4 + 2x - 7')

    // years: raw normal equations would be hopeless; centred QR is exact
    const yrs = [2000, 2002, 2004, 2006, 2008, 2010]
    const q = fitRegression('quadratic', yrs, yrs.map((x) => 0.25 * (x - 2004) ** 2 + 3))
    expect(q.r2).toBeCloseTo(1, 10)
    q.residuals.forEach((v) => expect(Math.abs(v)).toBeLessThan(1e-8))
    expect(q.coef.a).toBeCloseTo(0.25, 8)
    expect(q.notes.join(' ')).toMatch(/years since/)
  })

  it('noisy quadratic matches the closed-form 3×3 normal-equation answer', () => {
    const xs = [1, 2, 3, 4, 5, 6, 7]
    const ys = [2.3, 5.1, 10.2, 16.8, 26.1, 36.9, 50.2]
    const r = fitRegression('quadratic', xs, ys)
    // normal equations by hand (small, well-conditioned data)
    const S = (p: number) => xs.reduce((s, x) => s + x ** p, 0)
    const T = (p: number) => xs.reduce((s, x, i) => s + x ** p * ys[i], 0)
    const M = [[S(4), S(3), S(2)], [S(3), S(2), S(1)], [S(2), S(1), xs.length]]
    const v = [T(2), T(1), T(0)]
    const det = (m: number[][]) =>
      m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
      m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
      m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
    const D = det(M)
    const col = (j: number) => M.map((row, i) => row.map((e, k) => (k === j ? v[i] : e)))
    expect(r.coef.a).toBeCloseTo(det(col(0)) / D, 9)
    expect(r.coef.b).toBeCloseTo(det(col(1)) / D, 9)
    expect(r.coef.c).toBeCloseTo(det(col(2)) / D, 9)
    expect(r.r2).toBeCloseTo(r2Of(ys, xs.map((x) => modelAt(r, x))), 10)
  })
})

describe('fitRegression: linearised fits, the TI-84 way', () => {
  it('ExpReg: least squares on ln y — a = 3.0110, b = 1.99998', () => {
    const xs = [0, 1, 2, 3, 4]
    const ys = [3, 6.1, 11.8, 24.5, 47.9]
    const r = fitRegression('exponential', xs, ys)
    expect(r.ok).toBe(true)
    const ref = ols(xs, ys.map(Math.log))
    expect(Math.abs(r.coef.a - Math.exp(ref.intercept))).toBeLessThan(1e-9)
    expect(Math.abs(r.coef.b - Math.exp(ref.slope))).toBeLessThan(1e-9)
    expect(Math.abs(r.r! - ref.r)).toBeLessThan(1e-9)
    expect(Math.abs(r.r2Linearised! - ref.r * ref.r)).toBeLessThan(1e-9)
    // what a TI-84 prints for this list
    expect(r.coef.a).toBeCloseTo(3.011022, 5)
    expect(r.coef.b).toBeCloseTo(1.999984, 5)
    expect(r.r!).toBeCloseTo(0.999904, 5)
    // r² on the original data is a different (and smaller) number
    expect(r.r2).toBeCloseTo(r2Of(ys, xs.map((x) => modelAt(r, x))), 12)
    expect(r.r2).not.toBeCloseTo(r.r2Linearised!, 6)
    expect(r.notes.join(' ')).toMatch(/TI-84.*ln y/)
    const src = regressionSource(r)
    expect(src).toBe('y = 3.011(2)^x')
    expect(readExponential(src)).not.toBeNull()
    expect(readExponential(regressionSource(r, 6))).toMatchObject({ a: '3.011022', b: '1.999984' })
  })

  it('PwrReg: least squares on ln y against ln x', () => {
    const xs = [1, 2, 3, 4, 5, 6]
    const ys = [2.1, 5.9, 11.2, 16.8, 23.9, 31.2]
    const r = fitRegression('power', xs, ys)
    const ref = ols(xs.map(Math.log), ys.map(Math.log))
    expect(Math.abs(r.coef.a - Math.exp(ref.intercept))).toBeLessThan(1e-9)
    expect(Math.abs(r.coef.b - ref.slope)).toBeLessThan(1e-9)
    expect(Math.abs(r.r! - ref.r)).toBeLessThan(1e-9)
    expect(r.coef.a).toBeCloseTo(2.096429, 5) // a = 2.096429011
    expect(r.coef.b).toBeCloseTo(1.508844, 5) // b = 1.508844401
    expect(r.r!).toBeCloseTo(0.999940, 5) //     r = .9999397426
    expect(regressionSource(r)).toBe('y = 2.0964x^1.5088')
  })

  it('LnReg: least squares on y against ln x', () => {
    const xs = [1, 2, 4, 8, 16, 32]
    const ys = [3.1, 4.9, 7.2, 9.1, 10.8, 13.1]
    const r = fitRegression('logarithmic', xs, ys)
    const ref = ols(xs.map(Math.log), ys)
    expect(Math.abs(r.coef.a - ref.intercept)).toBeLessThan(1e-9)
    expect(Math.abs(r.coef.b - ref.slope)).toBeLessThan(1e-9)
    expect(Math.abs(r.r! - ref.r)).toBeLessThan(1e-9)
    expect(r.coef.a).toBeCloseTo(3.061905, 5) // a = 3.061904762
    expect(r.coef.b).toBeCloseTo(2.868902, 5) // b = 2.868902138
    expect(r.r!).toBeCloseTo(0.999199, 5) //     r = .9991986236
    expect(r.r2).toBeCloseTo(r.r! ** 2, 10) //   linear in y: the two r² agree
    const src = regressionSource(r)
    expect(src).toBe('y = 3.0619 + 2.8689ln(x)')
    // once readLogarithmic has landed, it must read the regression back
    if (readLogarithmic('y = 2ln(x) + 1')) expect(readLogarithmic(src)).not.toBeNull()
  })

  it('decreasing data: negative b in LnReg, base below 1 in ExpReg', () => {
    const ln = fitRegression('logarithmic', [1, 2, 3, 4], [5, 3.6, 2.8, 2.2])
    expect(regressionSource(ln)).toMatch(/^y = 5\.\d+ - 2\.\d+ln\(x\)$/)
    const ex = fitRegression('exponential', [0, 1, 2, 3], [100, 50, 25, 12.5])
    expect(ex.coef.a).toBeCloseTo(100, 10)
    expect(ex.coef.b).toBeCloseTo(0.5, 12)
    expect(regressionSource(ex)).toBe('y = 100(0.5)^x')
    expect(readExponential('y = 100(0.5)^x')).not.toBeNull()
  })
})

describe('fitRegression: nonlinear fits (Logistic, SinReg)', () => {
  it('logistic recovers c, a, b from noiseless data to 1e-6', () => {
    const c = 50, a = 20, b = 0.8
    const xs = range(0, 10, 1)
    const ys = xs.map((x) => c / (1 + a * Math.exp(-b * x)))
    const r = fitRegression('logistic', xs, ys)
    expect(r.ok, r.error).toBe(true)
    expect(Math.abs(r.coef.c - c)).toBeLessThan(1e-6)
    expect(Math.abs(r.coef.a - a) / a).toBeLessThan(1e-6)
    expect(Math.abs(r.coef.b - b)).toBeLessThan(1e-6)
    expect(r.r2).toBeCloseTo(1, 10)
    expect(r.r).toBeUndefined()
    expect(regressionSource(r)).toBe('y = 50/(1 + 20e^(-0.8x))')
  })

  it('logistic from years (a is huge; still recovered) and from noisy data', () => {
    const xs = range(1990, 2030, 2)
    const ys = xs.map((x) => 300 / (1 + Math.exp(-0.2 * (x - 2010))))
    const r = fitRegression('logistic', xs, ys)
    expect(r.ok, r.error).toBe(true)
    expect(r.coef.c).toBeCloseTo(300, 6)
    expect(r.coef.b).toBeCloseTo(0.2, 9)
    expect(Math.log(r.coef.a) / (0.2 * 2010)).toBeCloseTo(1, 9)

    const gauss = makeGauss(makeRng(7))
    const xn = range(0, 12, 0.5)
    const yn = xn.map((x) => 80 / (1 + 30 * Math.exp(-0.9 * x)) + 0.8 * gauss())
    const n = fitRegression('logistic', xn, yn.map((y) => Math.max(y, 0.05)))
    expect(n.ok).toBe(true)
    expect(Math.abs(n.coef.c - 80)).toBeLessThan(2)
    expect(Math.abs(n.coef.b - 0.9)).toBeLessThan(0.1)
    expect(Math.abs(Math.log(n.coef.a) - Math.log(30))).toBeLessThan(0.3)
    expect(n.r2).toBeGreaterThan(0.99)
  })

  it('sinusoidal recovers a, b, c, d from noiseless data to 1e-6', () => {
    const a = 2.5, b = 1.2, c = 0.7, d = 4
    const xs = range(0, 10, 0.5)
    const ys = xs.map((x) => a * Math.sin(b * x + c) + d)
    const r = fitRegression('sinusoidal', xs, ys)
    expect(r.ok, r.error).toBe(true)
    expect(Math.abs(r.coef.a - a)).toBeLessThan(1e-6)
    expect(Math.abs(r.coef.b - b)).toBeLessThan(1e-6)
    expect(Math.abs(r.coef.c - c)).toBeLessThan(1e-6)
    expect(Math.abs(r.coef.d - d)).toBeLessThan(1e-6)
    expect(regressionSource(r)).toBe('y = 2.5sin(1.2x + 0.7) + 4')
  })

  it('sinusoidal normalises a ≥ 0 and c into (−π, π]; months of temperatures', () => {
    // y = −3 sin(0.5x − 2) − 1 is 3 sin(0.5x − 2 + π) − 1
    const xs = range(0, 20, 1)
    const r = fitRegression('sinusoidal', xs, xs.map((x) => -3 * Math.sin(0.5 * x - 2) - 1))
    expect(r.coef.a).toBeCloseTo(3, 7)
    expect(r.coef.b).toBeCloseTo(0.5, 7)
    expect(r.coef.c).toBeCloseTo(Math.PI - 2, 7)
    expect(r.coef.d).toBeCloseTo(-1, 7)
    expect(regressionSource(r)).toBe('y = 3sin(0.5x + 1.1416) - 1')

    // a year of monthly highs: period 12
    const months = range(1, 12, 1)
    const temps = months.map((m) => 20 * Math.sin((Math.PI / 6) * m - 2.1) + 62)
    const t = fitRegression('sinusoidal', months, temps)
    expect(t.coef.b).toBeCloseTo(Math.PI / 6, 7)
    expect(t.coef.a).toBeCloseTo(20, 6)
    expect(t.coef.c).toBeCloseTo(-2.1, 6)
    expect(t.coef.d).toBeCloseTo(62, 6)
  })

  it('sinusoidal from noisy data lands within tolerance', () => {
    const gauss = makeGauss(makeRng(11))
    const xs = range(0, 15, 0.25)
    const ys = xs.map((x) => 4 * Math.sin(0.9 * x - 1.3) + 10 + 0.4 * gauss())
    const r = fitRegression('sinusoidal', xs, ys)
    expect(r.ok).toBe(true)
    expect(Math.abs(r.coef.a - 4)).toBeLessThan(0.2)
    expect(Math.abs(r.coef.b - 0.9)).toBeLessThan(0.02)
    expect(Math.abs(r.coef.c + 1.3)).toBeLessThan(0.15)
    expect(Math.abs(r.coef.d - 10)).toBeLessThan(0.15)
    expect(r.r2).toBeGreaterThan(0.97)
  })
})

describe('fitRegression: refusals and bookkeeping', () => {
  it('exponential with a y ≤ 0 is refused with the reason', () => {
    const r = fitRegression('exponential', [0, 1, 2, 3], [2, 4, 0, 16])
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/every y to be positive/)
    expect(r.error).toMatch(/\(2, 0\)/)
    const neg = fitRegression('exponential', [0, 1, 2], [-1, -2, -4])
    expect(neg.error).toMatch(/fit −y instead/)
    expect(fitRegression('power', [1, 2, 3], [1, -1, 2]).ok).toBe(false)
    expect(fitRegression('logistic', [1, 2, 3, 4], [1, 2, 0, 4]).ok).toBe(false)
  })

  it('logarithmic / power with an x ≤ 0 are refused', () => {
    const r = fitRegression('logarithmic', [0, 1, 2, 3], [1, 2, 3, 4])
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/every x to be positive/)
    expect(fitRegression('power', [-1, 1, 2], [1, 1, 2]).error).toMatch(/every x/)
  })

  it('degree needs n + 1 different x values', () => {
    const q = fitRegression('quartic', [1, 2, 3, 4], [1, 4, 9, 16])
    expect(q.ok).toBe(false)
    expect(q.error).toBe('A quartic needs at least 5 points with different x values — there are 4.')
    expect(fitRegression('quadratic', [1, 1, 2, 2], [1, 2, 3, 4]).ok).toBe(false)
    expect(fitRegression('linear', [3, 3, 3], [1, 2, 3]).ok).toBe(false)
    expect(fitRegression('sinusoidal', [1, 2, 3, 4], [1, 0, 1, 0]).error).toMatch(/at least 5 points/)
    expect(fitRegression('logistic', [1, 2, 3], [1, 2, 3]).error).toMatch(/at least 4 points/)
  })

  it('never throws; missing values are left out and residuals stay aligned', () => {
    const r = fitRegression('linear', [1, 2, NaN, 4, 5], [2, 4, 6, 8, 10])
    expect(r.ok).toBe(true)
    expect(r.residuals.length).toBe(5)
    expect(Number.isNaN(r.residuals[2])).toBe(true)
    expect(r.notes.join(' ')).toMatch(/Left out 1 row/)
    const kinds: RegressionKind[] = [
      'linear', 'quadratic', 'cubic', 'quartic', 'exponential', 'power', 'logarithmic', 'logistic', 'sinusoidal',
    ]
    for (const k of kinds) {
      for (const [xs, ys] of [[[], []], [[1], [1]], [[1, 2, 3, 4, 5, 6], [5, 5, 5, 5, 5, 5]], [[1e300, -1e300, 0, 1, 2], [1, 2, 3, 4, 5]]]) {
        expect(() => fitRegression(k, xs, ys)).not.toThrow()
        const res = fitRegression(k, xs, ys)
        if (!res.ok) expect(res.error).toBeTruthy()
        expect(() => regressionSource(res)).not.toThrow()
      }
    }
    expect(regressionSource(fitRegression('quartic', [1], [1]))).toBe('')
  })
})

// ---------------------------------------------------------------------------
// regressionSource: every output parses and draws the fitted curve
// ---------------------------------------------------------------------------

describe('regressionSource', () => {
  const gauss = makeGauss(makeRng(3))
  const xs = range(1, 8, 0.5)
  const cases: [RegressionKind, (x: number) => number][] = [
    ['linear', (x) => -0.73 * x + 12.4],
    ['quadratic', (x) => 0.31 * x * x - 2.2 * x + 1],
    ['cubic', (x) => -0.05 * x ** 3 + 0.4 * x * x - x + 3],
    ['quartic', (x) => 0.004 * x ** 4 - 0.05 * x ** 3 + 0.3 * x - 2],
    ['exponential', (x) => 120 * 0.83 ** x],
    ['power', (x) => 3.2 * x ** -0.7],
    ['logarithmic', (x) => -2 - 1.4 * Math.log(x)],
    ['logistic', (x) => 9 / (1 + 40 * Math.exp(-1.1 * x))],
    ['sinusoidal', (x) => 1.7 * Math.sin(2.1 * x - 2.8) - 0.6],
  ]
  for (const [kind, f] of cases) {
    it(`${kind}: parses and matches the fit at 4 and 7 digits`, () => {
      const ys = xs.map((x) => f(x) * (1 + 0.01 * gauss()))
      const r = fitRegression(kind, xs, ys)
      expect(r.ok, r.error).toBe(true)
      const src = expectSourceMatches(r, xs, 4)
      expect(src).not.toMatch(/\+ -|- -|\+ \+|(^|[^\d.])1x|\de[+-]?\d/)
      expectSourceMatches(r, xs, 7)
      if (kind === 'exponential') expect(readExponential(src)).not.toBeNull()
    })
  }

  it('small coefficients keep their significant figures', () => {
    const xs2 = [0, 1, 2, 3]
    const r = fitRegression('linear', xs2, xs2.map((x) => 0.000123456 * x + 5))
    expect(regressionSource(r)).toBe('y = 0.0001235x + 5')
    const big = fitRegression('linear', xs2, xs2.map((x) => 2e22 * x))
    const src = regressionSource(big)
    expect(src).not.toMatch(/e/)
    expect(evalSource(src, 1)).toBeCloseTo(2e22, -10)
  })

  it('an exponential base that rounds to 1 keeps enough digits', () => {
    const xs2 = [0, 10, 20, 30]
    const r = fitRegression('exponential', xs2, xs2.map((x) => 5 * 1.00002 ** x))
    const src = regressionSource(r)
    expect(src).toBe('y = 5(1.00002)^x')
    expect(readExponential(src)).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// suggestModels
// ---------------------------------------------------------------------------

describe('suggestModels', () => {
  it('ranks the cheap fits by (adjusted) r², then appends the rest', () => {
    const xs = [0, 1, 2, 3, 4, 5]
    const ys = xs.map((x) => 3 * 1.8 ** x)
    const s = suggestModels(xs, ys)
    expect(s[0]).toBe('exponential')
    expect(s.slice(-4)).toEqual(['cubic', 'quartic', 'logistic', 'sinusoidal'])
    expect(s).not.toContain('power') // x = 0
    expect(s).not.toContain('logarithmic')
  })

  it('linear data suggests the line first, not the barely-better quadratic', () => {
    const xs = [1, 2, 3, 4, 5, 6, 7]
    const ys = [2.1, 3.9, 6.2, 7.8, 10.1, 12.0, 13.9]
    expect(suggestModels(xs, ys)[0]).toBe('linear')
  })

  it('log-shaped data suggests logarithmic first', () => {
    const xs = [1, 2, 4, 8, 16, 32]
    expect(suggestModels(xs, xs.map((x) => 3 + 2 * Math.log(x)))[0]).toBe('logarithmic')
  })

  it('never includes an inadmissible kind', () => {
    const s = suggestModels([-2, -1, 0, 1], [3, -1, 2, 5])
    expect(s).toEqual(expect.arrayContaining(['linear', 'quadratic', 'cubic']))
    for (const k of ['quartic', 'exponential', 'power', 'logarithmic', 'logistic', 'sinusoidal']) {
      expect(s).not.toContain(k)
    }
    expect(suggestModels([1, 1], [2, 3])).toEqual([])
    expect(suggestModels([], [])).toEqual([])
    for (const k of suggestModels([1, 2, 3, 4, 5], [2, 3, 5, 4, 6])) {
      expect(fitRegression(k, [1, 2, 3, 4, 5], [2, 3, 5, 4, 6]).ok).toBe(true)
    }
  })
})
